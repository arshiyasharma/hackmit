import { createPrivateKey, createPublicKey } from "node:crypto";
import { CompactEncrypt, compactDecrypt, decodeProtectedHeader } from "jose";

/**
 * Message-level encryption — the JWE that wraps every VIC body.
 *
 * PORTED FROM `packages/api-client/src/mle.ts` in `github.com/visa/ai`. That
 * file uses `node-jose`; this uses `jose`, which is already a dependency here
 * and produces the identical JWE. The parameters are copied exactly:
 *
 *   alg: RSA-OAEP-256    key encryption
 *   enc: A128GCM         content encryption — NOT A256GCM. Visa's client uses
 *                        128 and a mismatch fails at the server with an opaque
 *                        error that says nothing about key sizes.
 *   kid: <VISA_KEY_ID>   the key identifier from the dashboard
 *   iat: Date.now()      MILLISECONDS, which is unusual, and is what Visa's
 *                        own client sends. Matched deliberately.
 *
 * THE REQUEST IS ENCRYPTED TO VISA'S CERTIFICATE, not to a bare public key.
 * `VISA_MLE_SERVER_CERT` is the X.509 PEM downloaded from the dashboard;
 * `createPublicKey` pulls the key out of it. The response comes back encrypted
 * to OUR certificate, so it is decrypted with our private key.
 *
 * NODE KEY OBJECTS ON PURPOSE. `createPrivateKey` accepts PKCS#1, PKCS#8 and
 * encrypted PEMs; `jose`'s own importers accept only PKCS#8. The dashboard and
 * `openssl req` hand out whichever they feel like, and a key that "looks fine"
 * but will not import is not a debugging session worth having at 3am.
 */

export interface EncryptedPayload {
  encData: string;
}

export class MleError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MleError";
  }
}

/** `\n` typed as two characters becomes a real newline; real newlines survive. */
export function unescapePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

/**
 * Wrap a payload for the wire.
 *
 * Returns `{ encData }`, and it is `JSON.stringify` of THAT object which
 * becomes the request body and which the X-Pay token is computed over.
 */
export async function encryptPayload(
  payload: unknown,
  serverCertPem: string,
  keyId: string
): Promise<EncryptedPayload> {
  const plaintext =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  let publicKey;
  try {
    // accepts an X.509 certificate PEM and extracts the public key from it
    publicKey = createPublicKey(unescapePem(serverCertPem));
  } catch (cause) {
    throw new MleError(
      "VISA_MLE_SERVER_CERT is not a PEM certificate we can read.",
      { cause }
    );
  }

  const encData = await new CompactEncrypt(new TextEncoder().encode(plaintext))
    .setProtectedHeader({
      alg: "RSA-OAEP-256",
      enc: "A128GCM",
      kid: keyId,
      // milliseconds, matching Visa's client exactly
      iat: Date.now(),
    })
    .encrypt(publicKey);

  return { encData };
}

/**
 * Unwrap a response.
 *
 * VIC ENCRYPTS ITS ERROR BODIES TOO. A failed call whose body was never
 * decrypted looks like gibberish and sends you hunting for the wrong problem,
 * so the client calls this on the failure path as well as the success one.
 */
export async function decryptPayload(
  response: unknown,
  privateKeyPem: string,
  keyId: string
): Promise<unknown> {
  const body =
    typeof response === "string"
      ? (JSON.parse(response) as Record<string, unknown>)
      : (response as Record<string, unknown> | null);

  const encData = body?.encData;
  if (typeof encData !== "string" || !encData) {
    throw new MleError("The response carried no encData to decrypt.");
  }

  /*
   * Check the key id BEFORE attempting the maths. A JWE encrypted under a
   * different certificate fails with `ERR_JWE_DECRYPTION_FAILED`, which says
   * nothing about why — and the usual why is that the certificate was renewed
   * and VISA_KEY_ID was not updated. Naming it here saves the hunt.
   */
  const header = decodeProtectedHeader(encData) as { kid?: string };
  if (keyId && header.kid && header.kid !== keyId) {
    throw new MleError(
      `The response was encrypted under key id ${header.kid}, but VISA_KEY_ID is ${keyId}. ` +
        `The certificate was probably renewed — update VISA_KEY_ID to match.`
    );
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(unescapePem(privateKeyPem));
  } catch (cause) {
    throw new MleError(
      "VISA_MLE_PRIVATE_KEY is not a PEM private key we can read.",
      { cause }
    );
  }

  let plaintext: Uint8Array;
  try {
    ({ plaintext } = await compactDecrypt(encData, privateKey));
  } catch (cause) {
    throw new MleError(
      "The response did not decrypt with VISA_MLE_PRIVATE_KEY — check VISA_KEY_ID matches the certificate.",
      { cause }
    );
  }

  const text = new TextDecoder().decode(plaintext);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // a body that decrypted but is not JSON is still worth handing back
    return text;
  }
}
