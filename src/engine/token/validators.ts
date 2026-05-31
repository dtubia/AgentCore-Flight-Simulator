import type { TokenValidationResult } from "../../model/auth";

export function tokenValidationPassed(validation?: TokenValidationResult): boolean {
  if (!validation) return false;
  return (
    validation.signatureValid &&
    validation.issuerValid &&
    validation.audienceValid &&
    validation.clientValid &&
    validation.scopesValid &&
    validation.expiryValid &&
    validation.customClaimsValid
  );
}

export function validationReason(validation?: TokenValidationResult): string {
  if (!validation) return "No token validation was performed.";
  if (tokenValidationPassed(validation)) return "JWT signature, issuer, audience, client, scope, expiry and custom claims are valid.";
  return validation.errors.join(" ");
}
