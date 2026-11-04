/**
 * Generation error copy.
 *
 * The mappings below are the strings the real playground bundle shows
 * (REPORT.md section 6 step 2), including the support address. They are kept
 * verbatim for parity; change SUPPORT_EMAIL to point at your own inbox.
 */

export const SUPPORT_EMAIL = "support@golpoai.com";

export class GenerationError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "generation_error") {
    super(message);
    this.name = "GenerationError";
    this.status = status;
    this.code = code;
  }
}

export function authenticationFailed(): GenerationError {
  return new GenerationError(401, "Authentication failed. Please sign in again.", "unauthorized");
}

export function insufficientCredits(): GenerationError {
  return new GenerationError(
    402,
    "You don't have enough credits to generate this video. Please upgrade your plan or buy more credits.",
    "insufficient_credits",
  );
}

export function planFeatureRequired(feature: string, plan: string): GenerationError {
  const label = feature.replace(/_/g, " ");
  return new GenerationError(
    403,
    `The ${label} feature is not included in the ${plan} plan. Please upgrade to continue.`,
    "plan_required",
  );
}

export function concurrentGeneration(): GenerationError {
  return new GenerationError(
    409,
    "Multiple video generations detected. Please wait for your current video to finish before starting another.",
    "concurrent_generation",
  );
}

export function serverError(message?: string): GenerationError {
  return new GenerationError(
    500,
    message?.trim() || `Something went wrong while generating your video. Please try again or email ${SUPPORT_EMAIL}.`,
    "server_error",
  );
}

export function validationError(message: string): GenerationError {
  return new GenerationError(400, message, "invalid_request");
}
