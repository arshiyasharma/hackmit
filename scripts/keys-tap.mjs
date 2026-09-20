/**
 * Print a fresh Ed25519 key pair for the Trusted Agent Protocol agent.
 *
 *   npm run keys:tap
 *
 * It writes NOTHING to disk. Everything goes to stdout, ready to paste:
 * four lines for .env.local, and one JSON entry for data/tap-registry.json
 * so the merchant side can look the key up.
 *
 * The private key is printed once and never stored. Lose it and generate
 * another — it authorises nothing but our own agent's signatures.
 */

import { generateKeyPairSync, randomUUID } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** PEM is multi-line; .env files are not. Escape the newlines. */
const oneLine = (pem) => pem.trim().replace(/\n/g, "\\n");

const agentId = "visa-room-agent";
const keyId = `vra-key-${randomUUID().slice(0, 4)}`;

console.log("# --- paste into .env.local ---");
console.log(`TAP_AGENT_ID=${agentId}`);
console.log(`TAP_KEY_ID=${keyId}`);
console.log(`TAP_ED25519_PRIVATE_KEY=${oneLine(privateKey)}`);
console.log(`TAP_ED25519_PUBLIC_KEY=${oneLine(publicKey)}`);
console.log();
console.log("# --- paste into data/tap-registry.json, under \"keys\" ---");
console.log(
  JSON.stringify(
    {
      [keyId]: {
        agentId,
        agentName: "VISA Room Agent",
        publicKeyPem: oneLine(publicKey),
        registeredAt: new Date().toISOString(),
      },
    },
    null,
    2
  )
);
console.log();
console.log("# The private key is not saved anywhere. Copy it now.");
