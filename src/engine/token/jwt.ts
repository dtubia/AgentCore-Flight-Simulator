import { decodeJwt, decodeProtectedHeader, jwtVerify, SignJWT } from "jose";
import type { InboundAuthConfig, TokenArtifact, TokenAuthorizationDetail, TokenValidationResult } from "../../model/auth";

const SECRET = new TextEncoder().encode("AGENTCORE_OAUTH_MISSION_CONTROL_SIMULATED_SECRET");
export const SIM_NOW = Math.floor(Date.parse("2026-05-30T12:00:00Z") / 1000);

export interface MockAccessTokenOptions {
  issuer: string;
  audience: string;
  clientId: string;
  subject: string;
  scopes: string[];
  tenant: string;
  groups: string[];
  lifetimeSeconds?: number;
  resource?: string | string[];
  authorizationDetails?: TokenAuthorizationDetail[];
  extraClaims?: Record<string, unknown>;
}

export async function createMockAccessToken(options: MockAccessTokenOptions): Promise<TokenArtifact> {
  const exp = SIM_NOW + (options.lifetimeSeconds ?? 3600);
  const claims = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    client_id: options.clientId,
    scope: options.scopes.join(" "),
    tenant: options.tenant,
    groups: options.groups,
    resource: options.resource ?? options.audience,
    authorization_details: options.authorizationDetails,
    iat: SIM_NOW,
    exp,
    jti: "jwt-001",
    ...options.extraClaims
  };
  const compact = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: "simulated-hs256-key" })
    .sign(SECRET);

  return {
    compact,
    label: "ACCESS_TOKEN_SIMULATED",
    header: decodeProtectedHeader(compact),
    claims,
    kind: "user-delegated",
    boundSubject: options.subject,
    downstreamAudience: options.audience,
    resource: options.resource ?? options.audience,
    authorizationDetails: options.authorizationDetails
  };
}

export async function validateTokenAgainstAuth(
  token: string | undefined,
  auth: InboundAuthConfig
): Promise<{ artifact?: TokenArtifact; validation: TokenValidationResult }> {
  const base: TokenValidationResult = {
    signatureValid: false,
    issuerValid: false,
    audienceValid: false,
    clientValid: false,
    scopesValid: false,
    expiryValid: false,
    customClaimsValid: false,
    errors: []
  };

  if (!token) {
    base.errors.push("Authorization bearer token is missing.");
    return { validation: base };
  }

  let claims: Record<string, unknown> = {};
  try {
    const verified = await jwtVerify(token, SECRET, { currentDate: new Date(SIM_NOW * 1000) });
    claims = verified.payload as Record<string, unknown>;
    base.signatureValid = true;
    base.expiryValid = true;
  } catch (error) {
    claims = decodeJwt(token) as Record<string, unknown>;
    const message = error instanceof Error ? error.message : "JWT verification failed.";
    base.errors.push(message);
    base.expiryValid = !message.toLowerCase().includes("expired");
  }

  const issuer = String(claims.iss ?? "");
  const audience = String(claims.aud ?? "");
  const clientId = String(claims.client_id ?? "");
  const tokenScopes = String(claims.scope ?? "").split(/\s+/).filter(Boolean);
  const exp = Number(claims.exp ?? 0);

  base.issuerValid = !auth.allowedIssuers?.length || auth.allowedIssuers.includes(issuer);
  base.audienceValid = !auth.allowedAudiences?.length || auth.allowedAudiences.includes(audience);
  base.clientValid = !auth.allowedClients?.length || auth.allowedClients.includes(clientId);
  base.scopesValid = !auth.allowedScopes?.length || auth.allowedScopes.every((scope) => tokenScopes.includes(scope));
  base.expiryValid = base.expiryValid && exp > SIM_NOW;
  base.customClaimsValid = Object.entries(auth.requiredClaims ?? {}).every(([key, expected]) => claims[key] === expected);

  if (!base.issuerValid) base.errors.push(`Issuer ${issuer || "<missing>"} is not allowed.`);
  if (!base.audienceValid) base.errors.push(`Audience ${audience || "<missing>"} is not allowed.`);
  if (!base.clientValid) base.errors.push(`Client ${clientId || "<missing>"} is not allowed.`);
  if (!base.scopesValid) base.errors.push(`Required scopes are missing: ${(auth.allowedScopes ?? []).join(" ")}.`);
  if (!base.expiryValid) base.errors.push("Token is expired at the simulation clock.");
  if (!base.customClaimsValid) base.errors.push("Required custom claims do not match.");

  return {
    artifact: {
      compact: token,
      label: "ACCESS_TOKEN_SIMULATED",
      header: decodeProtectedHeader(token),
      claims,
      validation: base,
      kind: "user-delegated",
      boundSubject: String(claims.sub ?? ""),
      downstreamAudience: audience,
      resource: claims.resource as string | string[] | undefined,
      authorizationDetails: claims.authorization_details as TokenAuthorizationDetail[] | undefined
    },
    validation: base
  };
}

export function scopesFromTokenArtifact(token?: TokenArtifact): string[] {
  const scope = token?.claims?.scope;
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
}
