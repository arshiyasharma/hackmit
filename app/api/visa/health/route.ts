import {
  enrollmentReferenceId,
  missingVicVars,
  OPTIONAL_VARS,
  REQUIRED_VARS,
  VTS_VAR,
} from "@/lib/visa/config";
import { VicApiError, vicRequest } from "@/lib/visa/vicClient";

/**
 * GET /api/visa/health — is VIC actually wired up?
 *
 * BUILD THIS FIRST AND HIT IT BEFORE ANYTHING ELSE. It turns "the Visa API is
 * broken" into "the keyId header is missing", which is the difference between
 * ten minutes and a lost night. Every VIC call shares one auth path, so if
 * this is green the rest is payload assembly.
 *
 * NAMES AND BOOLEANS, NEVER VALUES. It reports which variables are present.
 * It does not report what they are, not even a prefix — a health endpoint that
 * leaks four characters of a shared secret is a health endpoint that leaks a
 * shared secret.
 *
 * 503 when something is missing, with a sentence saying where it comes from.
 * 200 when the credentials are present AND a real authenticated call came back
 * — the point is to prove the round trip, not to congratulate ourselves on
 * having strings in the environment.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

function present(names: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, !!process.env[name]?.trim()]));
}

export async function GET() {
  const missing = missingVicVars();
  const vars = {
    required: present(REQUIRED_VARS),
    optional: present(OPTIONAL_VARS),
    [VTS_VAR]: !!enrollmentReferenceId(),
  };

  if (missing.length) {
    return Response.json(
      {
        ok: false,
        stage: "unconfigured",
        error:
          `Visa Intelligent Commerce is not configured yet. Missing ${missing.join(", ")}. ` +
          `The API key and shared secret come from VIC onboarding at developer.visa.com; ` +
          `the certificate, private key and key id come from the MLE section of the same ` +
          `project.`,
        vars,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  /*
   * The cheapest authenticated call that exercises the whole path: X-Pay
   * token, message-level encryption, the keyId header, and the decryption of
   * whatever comes back. A cancel against an instruction id that does not
   * exist is expected to FAIL at the business layer — and that is a pass here,
   * because a business-layer error means Visa read our request. A 401 means it
   * did not.
   */
  try {
    const probe = await vicRequest("PUT", "/vacp/v1/instructions/health-probe/cancel", {
      clientReferenceId: crypto.randomUUID(),
    });
    return Response.json(
      {
        ok: true,
        stage: "authenticated",
        note: "Credentials, encryption and signing all work end to end.",
        correlationId: probe.correlationId,
        vars,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof VicApiError) {
      // 401/403 is an auth problem and is the thing this endpoint exists to
      // catch. Anything else means Visa read us and disagreed about business
      // rules, which is exactly what a fake instruction id should produce.
      const authFailed = error.httpStatus === 401 || error.httpStatus === 403;
      return Response.json(
        {
          ok: !authFailed,
          stage: authFailed ? "auth-failed" : "authenticated",
          error: authFailed
            ? `Visa refused our credentials (${error.httpStatus}). Check that VISA_KEY_ID ` +
              `matches the certificate, and that the shared secret is the VIC one.`
            : null,
          note: authFailed
            ? null
            : "Visa read our request and answered at the business layer, so signing and encryption work.",
          httpStatus: error.httpStatus,
          correlationId: error.correlationId,
          vars,
        },
        { status: authFailed ? 502 : 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    console.error("[api/visa/health] probe failed", error);
    return Response.json(
      {
        ok: false,
        stage: "unreachable",
        error: "We could not reach sandbox.api.visa.com.",
        vars,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
