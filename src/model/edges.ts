import type { AuthMode } from "./auth";

export type EdgeKind =
  | "user_to_client"
  | "client_to_idp"
  | "client_to_runtime"
  | "user_to_runtime"
  | "client_to_gateway_mcp"
  | "client_to_external_api"
  | "external_agent_to_authorization_server"
  | "external_agent_to_gateway_mcp"
  | "external_agent_to_mcp_direct"
  | "external_agent_to_runtime_http"
  | "external_agent_to_runtime_a2a"
  | "external_agent_to_external_api"
  | "runtime_to_runtime_http"
  | "runtime_to_runtime_a2a"
  | "runtime_to_gateway_mcp"
  | "runtime_to_mcp_direct"
  | "runtime_to_external_api"
  | "gateway_to_mcp_target"
  | "gateway_to_http_runtime_target"
  | "gateway_to_external_api_target"
  | "runtime_to_identity"
  | "runtime_to_authorization_server"
  | "gateway_to_identity"
  | "gateway_to_authorization_server_interceptor"
  | "identity_to_authorization_server"
  | "authorization_server_to_identity"
  | "gateway_to_policy_engine"
  | "mcp_to_saas_resource";

export interface ScenarioEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  authMode?: AuthMode;
  forwardedOAuthTokenHeader?: string;
  credentialProviderName?: string;
  credentialProviderFlow?: "ON_BEHALF_OF_TOKEN_EXCHANGE" | "CLIENT_CREDENTIALS" | "AUTHORIZATION_CODE" | "API_KEY";
  invalid?: boolean;
  invalidReason?: string;
}

export const EDGE_LABELS: Record<EdgeKind, string> = {
  user_to_client: "User opens client",
  client_to_idp: "OAuth/OIDC",
  client_to_runtime: "Invoke Runtime",
  user_to_runtime: "Direct runtime invoke",
  client_to_gateway_mcp: "Client Gateway MCP",
  client_to_external_api: "Client API",
  external_agent_to_authorization_server: "External agent OAuth client",
  external_agent_to_gateway_mcp: "External agent Gateway MCP",
  external_agent_to_mcp_direct: "External agent MCP",
  external_agent_to_runtime_http: "External agent Runtime HTTP",
  external_agent_to_runtime_a2a: "External agent A2A",
  external_agent_to_external_api: "External agent API",
  runtime_to_runtime_http: "Runtime HTTP",
  runtime_to_runtime_a2a: "A2A",
  runtime_to_gateway_mcp: "Gateway MCP",
  runtime_to_mcp_direct: "Direct MCP",
  runtime_to_external_api: "Runtime API",
  gateway_to_mcp_target: "MCP target",
  gateway_to_http_runtime_target: "HTTP runtime target",
  gateway_to_external_api_target: "HTTP API target",
  runtime_to_identity: "Identity",
  runtime_to_authorization_server: "Runtime OAuth client",
  gateway_to_identity: "Identity",
  gateway_to_authorization_server_interceptor: "Lambda interceptor OAuth",
  identity_to_authorization_server: "OAuth provider",
  authorization_server_to_identity: "OAuth provider callback",
  gateway_to_policy_engine: "Policy",
  mcp_to_saas_resource: "SaaS resource"
};

const allEdgeKinds = Object.keys(EDGE_LABELS) as EdgeKind[];

export function isControlPlaneEdgeKind(kind: EdgeKind): boolean {
  return (
    kind === "client_to_idp" ||
    kind === "external_agent_to_authorization_server" ||
    kind === "runtime_to_authorization_server" ||
    kind === "gateway_to_authorization_server_interceptor" ||
    kind === "identity_to_authorization_server" ||
    kind === "authorization_server_to_identity" ||
    kind === "runtime_to_identity" ||
    kind === "gateway_to_identity" ||
    kind === "gateway_to_policy_engine"
  );
}

export function isLegalEdge(kind: EdgeKind, sourceType: string, targetType: string): boolean {
  const pair = `${sourceType}->${targetType}`;
  const legal: Record<EdgeKind, string[]> = {
    user_to_client: ["user->client_app"],
    client_to_idp: ["client_app->authorization_server"],
    client_to_runtime: ["client_app->agentcore_runtime_agent"],
    user_to_runtime: ["user->agentcore_runtime_agent"],
    client_to_gateway_mcp: ["client_app->agentcore_gateway"],
    client_to_external_api: ["client_app->external_api"],
    external_agent_to_authorization_server: ["external_genai_agent->authorization_server"],
    external_agent_to_gateway_mcp: ["external_genai_agent->agentcore_gateway"],
    external_agent_to_mcp_direct: ["external_genai_agent->agentcore_mcp_server", "external_genai_agent->external_mcp_server"],
    external_agent_to_runtime_http: ["external_genai_agent->agentcore_runtime_agent"],
    external_agent_to_runtime_a2a: ["external_genai_agent->agentcore_runtime_agent"],
    external_agent_to_external_api: ["external_genai_agent->external_api"],
    runtime_to_runtime_http: ["agentcore_runtime_agent->agentcore_runtime_agent"],
    runtime_to_runtime_a2a: ["agentcore_runtime_agent->agentcore_runtime_agent"],
    runtime_to_gateway_mcp: ["agentcore_runtime_agent->agentcore_gateway"],
    runtime_to_mcp_direct: ["agentcore_runtime_agent->agentcore_mcp_server", "agentcore_runtime_agent->external_mcp_server"],
    runtime_to_external_api: ["agentcore_runtime_agent->external_api"],
    gateway_to_mcp_target: ["agentcore_gateway->agentcore_mcp_server", "agentcore_gateway->external_mcp_server"],
    gateway_to_http_runtime_target: ["agentcore_gateway->agentcore_runtime_agent"],
    gateway_to_external_api_target: ["agentcore_gateway->external_api"],
    runtime_to_identity: ["agentcore_runtime_agent->agentcore_identity"],
    runtime_to_authorization_server: ["agentcore_runtime_agent->authorization_server"],
    gateway_to_identity: ["agentcore_gateway->agentcore_identity"],
    gateway_to_authorization_server_interceptor: ["agentcore_gateway->authorization_server"],
    identity_to_authorization_server: ["agentcore_identity->authorization_server"],
    authorization_server_to_identity: ["authorization_server->agentcore_identity"],
    gateway_to_policy_engine: ["agentcore_gateway->policy_engine"],
    mcp_to_saas_resource: ["external_mcp_server->saas_resource"]
  };
  return legal[kind].includes(pair);
}

export function legalEdgeKinds(sourceType: string, targetType: string): EdgeKind[] {
  return allEdgeKinds.filter((kind) => isLegalEdge(kind, sourceType, targetType));
}
