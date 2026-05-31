import type { MutationConfig } from "../model/schema";

export const allMutations: MutationConfig[] = [
  { id: "remove_authorization_header", label: "Remove Authorization header", description: "Drop bearer or SigV4 Authorization from the selected request.", target: "header", expectedFinding: "Authentication fails before policy." },
  { id: "expire_token", label: "Expire token", description: "Issue the user JWT with an expired exp claim.", target: "token", expectedFinding: "Runtime rejects expired token." },
  { id: "wrong_audience", label: "Wrong audience", description: "Issue the JWT for Google Drive instead of AgentCore Runtime.", target: "token", expectedFinding: "Audience isolation blocks replay." },
  { id: "wrong_issuer", label: "Wrong issuer", description: "Change iss to an untrusted issuer.", target: "token", expectedFinding: "Issuer validation fails." },
  { id: "missing_scope", label: "Missing scope", description: "Remove the required agent.invoke scope.", target: "token", expectedFinding: "Scope validation fails." },
  { id: "change_subject_bob", label: "Subject user-bob", description: "Change sub from user-alice to user-bob.", target: "token", expectedFinding: "Resource ownership checks can detect confused deputy risk." },
  { id: "change_tenant_claim", label: "Change tenant", description: "Change tenant claim from bbva-demo.", target: "token", expectedFinding: "Custom claim validation fails." },
  { id: "remove_mcp_session_id", label: "Remove Mcp-Session-Id", description: "Do not reuse the stateful MCP session id.", target: "session", expectedFinding: "Stateful MCP warning." },
  { id: "disable_gateway_policy", label: "Disable Gateway policy", description: "Bypass the policy engine for comparison.", target: "policy", expectedFinding: "Central policy is absent." },
  { id: "policy_log_only", label: "Policy LOG_ONLY", description: "Switch policy mode from ENFORCE to LOG_ONLY.", target: "policy", expectedFinding: "Deny is logged but does not block." },
  { id: "direct_mcp_instead_gateway", label: "Direct MCP", description: "Prefer direct MCP call instead of Gateway-mediated call.", target: "edge", expectedFinding: "Direct MCP bypass warning." },
  { id: "direct_agent_instead_gateway", label: "Direct agent", description: "Prefer direct runtime/A2A call instead of Gateway-mediated call.", target: "edge", expectedFinding: "Direct agent bypass warning." },
  { id: "autonomous_credential", label: "Autonomous credential", description: "Use client credentials instead of user-delegated OBO.", target: "credentialProvider", expectedFinding: "Missing user binding." },
  { id: "token_exchange_extra_scope", label: "Token exchange extra scope", description: "Request a downstream token with an additional scope not granted to the provider/client.", target: "credentialProvider", expectedFinding: "Authorization server denies requested permission expansion." },
  { id: "force_3lo_reauth", label: "Force 3LO reauth", description: "Simulate that the downstream OAuth token is absent and consent is needed.", target: "credentialProvider", expectedFinding: "User consent flow required." },
  { id: "request_sensitive_workday", label: "Sensitive Workday data", description: "Call workday.get_compensation without the correct scope.", target: "policy", expectedFinding: "Sensitive policy deny." },
  { id: "sigv4_missing_authorization", label: "Missing SigV4 auth", description: "Remove the SigV4 Authorization header.", target: "sigv4", expectedFinding: "403 ACCESS_DENIED without WWW-Authenticate." },
  { id: "sigv4_wrong_region_service", label: "Wrong SigV4 scope", description: "Sign for the wrong region and service.", target: "sigv4", expectedFinding: "Credential scope validation fails." },
  { id: "sigv4_clock_skew", label: "SigV4 clock skew", description: "Send an old X-Amz-Date.", target: "sigv4", expectedFinding: "Clock skew validation fails." },
  { id: "sigv4_missing_invoke_permission", label: "Missing InvokeRuntime", description: "Remove bedrock-agentcore:InvokeAgentRuntime from the signing principal.", target: "sigv4", expectedFinding: "IAM action authorization fails." },
  { id: "runtime_target_sigv4", label: "Runtime target SigV4", description: "Use SigV4 for Gateway to Runtime target invocation.", target: "sigv4", expectedFinding: "Gateway-to-runtime SigV4 is inspected." },
  { id: "forwarded_oauth_header_missing", label: "Missing OAuth context header", description: "Remove the custom forwarded OAuth token header from SigV4 calls.", target: "header", expectedFinding: "Gateway cannot bind SigV4 call to user context." }
];

export function mergeMutations<T extends { mutations: MutationConfig[] }>(scenario: T): T {
  const existing = new Map(scenario.mutations.map((mutation) => [mutation.id, mutation]));
  return {
    ...scenario,
    mutations: allMutations.map((mutation) => ({ ...mutation, ...(existing.get(mutation.id) ?? {}) }))
  };
}
