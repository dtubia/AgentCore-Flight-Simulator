import type { AuthMode, InboundAuthConfig } from "./auth";

export type NodeType =
  | "user"
  | "client_app"
  | "external_genai_agent"
  | "authorization_server"
  | "agentcore_runtime_agent"
  | "agentcore_gateway"
  | "agentcore_identity"
  | "policy_engine"
  | "agentcore_mcp_server"
  | "external_mcp_server"
  | "external_api"
  | "saas_resource";

export interface ScenarioNodeBase<T extends NodeType = NodeType> {
  id: string;
  type: T;
  position?: { x: number; y: number };
  displayName?: string;
}

export interface UserNode extends ScenarioNodeBase<"user"> {
  tenant: string;
  groups: string[];
  department: string;
  riskLevel: "standard" | "high";
}

export interface ClientAppNode extends ScenarioNodeBase<"client_app"> {
  clientId: string;
  redirectUri: string;
  pkce: boolean;
  allowedScopes: string[];
  oauthGrants?: OAuthClientGrant[];
}

export interface OAuthClientGrant {
  clientId: string;
  allowedResources: string[];
  allowedScopes: string[];
  allowTokenExchange: boolean;
  allowActAsSubject?: boolean;
  allowActAsActor?: boolean;
}

export interface ExternalGenAiAgentNode extends ScenarioNodeBase<"external_genai_agent"> {
  name: string;
  framework: "LangGraph" | "CrewAI" | "OpenAI Agents SDK" | "Custom";
  endpoint: string;
  supportedProtocols: Array<"HTTP" | "MCP" | "A2A">;
  outboundAuthModes: AuthMode[];
  oauthClientId?: string;
  awsPrincipalArn?: string;
  oauthGrants?: OAuthClientGrant[];
}

export interface AuthorizationServerNode extends ScenarioNodeBase<"authorization_server"> {
  issuer: string;
  jwksUri: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  supportedGrantTypes: string[];
  tokenLifetimeSeconds: number;
}

export interface WorkloadIdentity {
  name: string;
  arn: string;
}

export interface RuntimeSession {
  runtimeSessionId: string;
  state: "idle" | "active" | "error";
}

export interface AgentCoreRuntimeAgentNode extends ScenarioNodeBase<"agentcore_runtime_agent"> {
  name: string;
  runtimeArn: string;
  qualifier: string;
  protocol: "HTTP" | "MCP" | "A2A" | "AGUI";
  inboundAuth: InboundAuthConfig;
  workloadIdentity: WorkloadIdentity;
  session: RuntimeSession;
}

export interface AgentCoreGatewayNode extends ScenarioNodeBase<"agentcore_gateway"> {
  gatewayArn: string;
  gatewayUrl: string;
  protocol: "MCP";
  inboundAuth: InboundAuthConfig;
  targetAuth?: AuthMode;
  policyMode: "LOG_ONLY" | "ENFORCE";
  semanticSearchEnabled: boolean;
}

export interface CredentialProvider {
  name: string;
  kind: "oauth2" | "api_key";
  vendor: string;
  flow: "ON_BEHALF_OF_TOKEN_EXCHANGE" | "CLIENT_CREDENTIALS" | "AUTHORIZATION_CODE" | "API_KEY";
  authorizationServerId?: string;
  issuer?: string;
  tokenEndpoint?: string;
  allowedWorkloadIdentities: string[];
  allowedClients?: string[];
  allowedResources?: string[];
  allowTokenExchange?: boolean;
  allowSubjectDelegation?: boolean;
  tokenExchange?: {
    grantType: "TOKEN_EXCHANGE" | "JWT_AUTHORIZATION_GRANT";
    actorTokenContent?: "M2M" | "AWS_IAM_ID_TOKEN_JWT" | "NONE";
    actorTokenScopes?: string[];
    allowAdditionalScopes?: boolean;
  };
  scopes: string[];
}

export interface AgentCoreIdentityNode extends ScenarioNodeBase<"agentcore_identity"> {
  tokenVault: { arn: string };
  credentialProviders: CredentialProvider[];
}

export interface LocalPolicy {
  id: string;
  effect: "allow" | "deny";
  principal: string | "*";
  action: string | "*";
  resource?: string | "*";
  condition?: string;
}

export interface PolicyEngineNode extends ScenarioNodeBase<"policy_engine"> {
  mode: "LOG_ONLY" | "ENFORCE";
  policies: LocalPolicy[];
}

export interface McpTool {
  name: string;
  description: string;
  requiredScopes: string[];
  sensitive?: boolean;
  inputSchema: Record<string, unknown>;
}

export interface AgentCoreMcpServerNode extends ScenarioNodeBase<"agentcore_mcp_server"> {
  name: string;
  runtimeArn: string;
  protocol: "MCP";
  endpoint: "/mcp";
  port: number;
  statelessHttp: boolean;
  requiresMcpSessionId: boolean;
  tools: McpTool[];
}

export interface ExternalMcpServerNode extends ScenarioNodeBase<"external_mcp_server"> {
  name: string;
  vendor: "Google" | "Slack" | "GitHub" | "Workday";
  endpoint: string;
  auth: {
    type: "OAuth2" | "API_KEY";
    mode: "client_credentials" | "authorization_code" | "on_behalf_of" | "api_key";
    credentialProviderName: string;
  };
  tools: McpTool[];
  errors?: string[];
}

export interface SaasResourceNode extends ScenarioNodeBase<"saas_resource"> {
  vendor: string;
  endpoint: string;
}

export interface ExternalApiNode extends ScenarioNodeBase<"external_api"> {
  name: string;
  endpoint: string;
  protocol: "HTTP";
  auth: {
    modes: AuthMode[];
    requiredScopes?: string[];
    requiredAction?: string;
  };
}

export type ScenarioNode =
  | UserNode
  | ClientAppNode
  | ExternalGenAiAgentNode
  | AuthorizationServerNode
  | AgentCoreRuntimeAgentNode
  | AgentCoreGatewayNode
  | AgentCoreIdentityNode
  | PolicyEngineNode
  | AgentCoreMcpServerNode
  | ExternalMcpServerNode
  | ExternalApiNode
  | SaasResourceNode;

export function nodeLabel(node: ScenarioNode): string {
  if (node.displayName) return node.displayName;
  if ("name" in node) return String(node.name);
  return node.id;
}
