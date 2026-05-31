import type { InboundAuthConfig, SigV4ValidationResult } from "../../model/auth";
import { SIM_NOW } from "../token/jwt";

export interface SigV4RequestInput {
  method: string;
  host: string;
  path: string;
  body: unknown;
  auth: InboundAuthConfig;
  action: string;
  resource: string;
  mutations: Set<string>;
}

export function createSigV4Headers(input: SigV4RequestInput): Record<string, string> {
  const region = input.mutations.has("sigv4_wrong_region_service") ? "us-east-1" : input.auth.sigv4?.region ?? "us-west-2";
  const service = input.mutations.has("sigv4_wrong_region_service") ? "execute-api" : input.auth.sigv4?.service ?? "bedrock-agentcore";
  const date = input.mutations.has("sigv4_clock_skew") ? "20260529T020000Z" : "20260530T120000Z";
  const signedHeaders = "content-type;host;x-amz-date;x-amz-security-token";
  const credentialScope = `20260530/${region}/${service}/aws4_request`;
  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=AWS_ACCESS_KEY_ID_SIMULATED/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=SIGV4_SIGNATURE_SIMULATED`,
    "X-Amz-Date": date,
    "X-Amz-Security-Token": "AWS_SESSION_TOKEN_SIMULATED"
  };
}

export function validateSigV4(input: SigV4RequestInput): SigV4ValidationResult {
  const configured = input.auth.sigv4;
  const headers = createSigV4Headers(input);
  const authorization = input.mutations.has("sigv4_missing_authorization") ? "" : headers.Authorization;
  const credentialMatch = authorization.match(/Credential=AWS_ACCESS_KEY_ID_SIMULATED\/([^,]+)/);
  const signedHeadersMatch = authorization.match(/SignedHeaders=([^,]+)/);
  const scope = credentialMatch?.[1] ?? "";
  const [date, region, service] = scope.split("/");
  const signedHeaders = signedHeadersMatch?.[1]?.split(";") ?? [];
  const principalArn = configured?.principalArn ?? "arn:aws:iam::123456789012:role/AgentCoreGatewayRuntimeInvokeRole";
  const actionAllowed = !input.mutations.has("sigv4_missing_invoke_permission") && Boolean(configured?.allowedActions.includes(input.action));
  const resourceAllowed = Boolean(configured?.allowedResources.some((resource) => resource === "*" || resource === input.resource));
  const clockSkewSeconds = input.mutations.has("sigv4_clock_skew") ? 86400 : 0;
  const clockSkewValid = !input.mutations.has("sigv4_clock_skew") && clockSkewSeconds <= 300;
  const canonicalRequest = [
    input.method,
    input.path,
    "",
    `content-type:application/json`,
    `host:${input.host}`,
    `x-amz-date:${headers["X-Amz-Date"]}`,
    `x-amz-security-token:AWS_SESSION_TOKEN_SIMULATED`,
    "",
    "content-type;host;x-amz-date;x-amz-security-token",
    "UNSIGNED-PAYLOAD-SIMULATED"
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", headers["X-Amz-Date"], scope, "HASHED_CANONICAL_REQUEST_SIMULATED"].join("\n");

  const result: SigV4ValidationResult = {
    signatureValid: Boolean(authorization) && !input.mutations.has("sigv4_bad_signature"),
    credentialScopeValid: date === "20260530" && scope.endsWith("/aws4_request"),
    regionValid: region === configured?.region,
    serviceValid: service === configured?.service,
    clockSkewValid,
    signedHeadersValid: ["content-type", "host", "x-amz-date", "x-amz-security-token"].every((header) => signedHeaders.includes(header)),
    principalAllowed: Boolean(configured?.principalArn === principalArn),
    actionAllowed,
    resourceAllowed,
    principalArn,
    action: input.action,
    resource: input.resource,
    region,
    service,
    signedHeaders,
    canonicalRequest,
    stringToSign,
    credentialScope: scope,
    errors: []
  };

  if (!result.signatureValid) result.errors.push("SigV4 Authorization header is missing or the simulated signature is invalid.");
  if (!result.regionValid) result.errors.push(`SigV4 region ${region || "<missing>"} does not match ${configured?.region}.`);
  if (!result.serviceValid) result.errors.push(`SigV4 service ${service || "<missing>"} does not match ${configured?.service}.`);
  if (!result.clockSkewValid) result.errors.push("SigV4 request timestamp exceeds the allowed clock skew.");
  if (!result.actionAllowed) result.errors.push(`Principal is not allowed to call ${input.action}.`);
  if (!result.resourceAllowed) result.errors.push("Principal is not allowed to invoke this runtime resource.");
  return result;
}

export function sigv4Passed(result?: SigV4ValidationResult): boolean {
  if (!result) return false;
  return (
    result.signatureValid &&
    result.credentialScopeValid &&
    result.regionValid &&
    result.serviceValid &&
    result.clockSkewValid &&
    result.signedHeadersValid &&
    result.principalAllowed &&
    result.actionAllowed &&
    result.resourceAllowed
  );
}
