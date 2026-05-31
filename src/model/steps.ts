import type { AuthMode } from "./auth";
import type { EdgeKind, ScenarioEdge } from "./edges";
import type { ScenarioNode } from "./nodes";

export type StepActionKind =
  | "user_open_client"
  | "oauth_authorization_code_pkce"
  | "runtime_invoke"
  | "workload_identity_token"
  | "gateway_tools_list_call"
  | "gateway_policy_evaluation"
  | "identity_resource_token"
  | "identity_keycloak_provider"
  | "gateway_mcp_target_call"
  | "direct_mcp_call"
  | "direct_a2a"
  | "gateway_runtime_sigv4_proxy"
  | "external_api_call"
  | "generic_topology_call";

export type StepAuthStrategy =
  | "none"
  | "oauth_authorization_code_pkce"
  | "oauth_bearer"
  | "oauth_token_exchange_obo"
  | "oauth_client_credentials"
  | "sigv4"
  | "sigv4_with_forwarded_oauth"
  | "api_key"
  | "identity_provider"
  | "policy";

export type StepRunStatus = "idle" | "running" | "success" | "failed" | "skipped" | "warning";

export interface AuthorizationDetail {
  type: string;
  locations?: string[];
  actions?: string[];
  datatypes?: string[];
  resources?: string[];
  tools?: string[];
  [key: string]: unknown;
}

export interface ScenarioStep {
  id: string;
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  actionKind: StepActionKind;
  authStrategy: StepAuthStrategy;
  resource?: string;
  authorizationDetails?: AuthorizationDetail[];
  scopes?: string[];
  toolName?: string;
  status?: StepRunStatus;
  order: number;
  branchId?: string;
  stopOnFailure?: boolean;
  label?: string;
}

const edgeAction: Record<EdgeKind, StepActionKind> = {
  user_to_client: "user_open_client",
  client_to_idp: "oauth_authorization_code_pkce",
  client_to_runtime: "runtime_invoke",
  user_to_runtime: "runtime_invoke",
  client_to_gateway_mcp: "gateway_tools_list_call",
  client_to_external_api: "external_api_call",
  external_agent_to_authorization_server: "oauth_authorization_code_pkce",
  external_agent_to_gateway_mcp: "gateway_tools_list_call",
  external_agent_to_mcp_direct: "direct_mcp_call",
  external_agent_to_runtime_http: "runtime_invoke",
  external_agent_to_runtime_a2a: "direct_a2a",
  external_agent_to_external_api: "external_api_call",
  runtime_to_runtime_http: "runtime_invoke",
  runtime_to_runtime_a2a: "direct_a2a",
  runtime_to_gateway_mcp: "gateway_tools_list_call",
  runtime_to_mcp_direct: "direct_mcp_call",
  runtime_to_external_api: "external_api_call",
  gateway_to_mcp_target: "gateway_mcp_target_call",
  gateway_to_http_runtime_target: "gateway_runtime_sigv4_proxy",
  gateway_to_external_api_target: "external_api_call",
  runtime_to_identity: "workload_identity_token",
  runtime_to_authorization_server: "oauth_authorization_code_pkce",
  gateway_to_identity: "identity_resource_token",
  gateway_to_authorization_server_interceptor: "generic_topology_call",
  identity_to_authorization_server: "identity_keycloak_provider",
  authorization_server_to_identity: "identity_keycloak_provider",
  gateway_to_policy_engine: "gateway_policy_evaluation",
  mcp_to_saas_resource: "external_api_call"
};

function nodeResource(node?: ScenarioNode): string | undefined {
  if (!node) return undefined;
  if (node.type === "agentcore_runtime_agent" || node.type === "agentcore_mcp_server") return node.runtimeArn;
  if (node.type === "agentcore_gateway") return node.gatewayArn;
  if (node.type === "external_mcp_server" || node.type === "external_api" || node.type === "saas_resource") return node.endpoint;
  if (node.type === "authorization_server") return node.issuer;
  return node.id;
}

function authStrategy(edge: ScenarioEdge): StepAuthStrategy {
  if (edge.kind === "client_to_idp" || edge.kind === "external_agent_to_authorization_server" || edge.kind === "runtime_to_authorization_server") return "oauth_authorization_code_pkce";
  if (edge.kind === "identity_to_authorization_server" || edge.kind === "authorization_server_to_identity") return "identity_provider";
  if (edge.kind === "gateway_to_policy_engine") return "policy";
  if (edge.kind === "gateway_to_identity") return edge.credentialProviderFlow === "CLIENT_CREDENTIALS" ? "oauth_client_credentials" : "oauth_token_exchange_obo";
  if (edge.authMode === "AWS_IAM_SIGV4") return edge.forwardedOAuthTokenHeader ? "sigv4_with_forwarded_oauth" : "sigv4";
  if (edge.authMode === "OAUTH_JWT") return "oauth_bearer";
  return "none";
}

function inferScopes(edge: ScenarioEdge): string[] | undefined {
  if (edge.kind === "client_to_idp") return ["openid", "profile", "agent.invoke"];
  if (edge.kind.includes("gateway") || edge.kind.includes("mcp")) return ["mcp.tools.list", "mcp.tools.call"];
  if (edge.kind.includes("runtime") || edge.kind.includes("a2a")) return ["agent.invoke"];
  return undefined;
}

function inferAuthorizationDetails(edge: ScenarioEdge, target?: ScenarioNode): AuthorizationDetail[] | undefined {
  const resource = nodeResource(target);
  if (!resource) return undefined;
  if (edge.kind.includes("mcp") || target?.type === "agentcore_gateway" || target?.type === "external_mcp_server" || target?.type === "agentcore_mcp_server") {
    return [{ type: "mcp", locations: [resource], actions: ["tools/list", "tools/call"] }];
  }
  if (edge.kind.includes("runtime") || edge.kind.includes("a2a")) {
    return [{ type: "agentcore_runtime", locations: [resource], actions: ["agent.invoke"] }];
  }
  if (edge.kind === "gateway_to_policy_engine") {
    return [{ type: "agentcore_policy", resources: [resource], actions: ["policy.evaluate"] }];
  }
  return [{ type: "resource", locations: [resource] }];
}

export function stepFromEdge(edge: ScenarioEdge, order: number, nodes: ScenarioNode[] = []): ScenarioStep {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  return {
    id: `step-${edge.id}`,
    edgeId: edge.id,
    sourceNodeId: edge.source,
    targetNodeId: edge.target,
    actionKind: edgeAction[edge.kind] ?? "generic_topology_call",
    authStrategy: authStrategy(edge),
    resource: nodeResource(target),
    authorizationDetails: inferAuthorizationDetails(edge, target),
    scopes: inferScopes(edge),
    toolName: target?.type === "external_mcp_server" || target?.type === "agentcore_mcp_server" ? target.tools[0]?.name : undefined,
    order,
    branchId: edge.kind.includes("direct") ? "direct" : edge.kind.includes("gateway") ? "gateway" : undefined,
    stopOnFailure: !(edge.kind.includes("direct") || edge.kind.includes("gateway")),
    status: "idle",
    label: edge.label
  };
}

const priorityByKind: Record<EdgeKind, number> = {
  user_to_client: 10,
  client_to_idp: 20,
  external_agent_to_authorization_server: 20,
  client_to_runtime: 30,
  user_to_runtime: 30,
  external_agent_to_runtime_http: 30,
  external_agent_to_runtime_a2a: 30,
  runtime_to_identity: 40,
  runtime_to_mcp_direct: 45,
  runtime_to_runtime_a2a: 45,
  runtime_to_runtime_http: 46,
  external_agent_to_mcp_direct: 46,
  runtime_to_gateway_mcp: 50,
  client_to_gateway_mcp: 50,
  external_agent_to_gateway_mcp: 50,
  gateway_to_policy_engine: 60,
  gateway_to_identity: 70,
  identity_to_authorization_server: 80,
  authorization_server_to_identity: 81,
  runtime_to_authorization_server: 82,
  gateway_to_authorization_server_interceptor: 83,
  gateway_to_mcp_target: 90,
  gateway_to_http_runtime_target: 90,
  gateway_to_external_api_target: 90,
  runtime_to_external_api: 95,
  client_to_external_api: 95,
  external_agent_to_external_api: 95,
  mcp_to_saas_resource: 100
};

export function buildMagicSteps(edges: ScenarioEdge[], nodes: ScenarioNode[]): ScenarioStep[] {
  return [...edges]
    .sort((a, b) => (priorityByKind[a.kind] ?? 999) - (priorityByKind[b.kind] ?? 999) || a.id.localeCompare(b.id))
    .map((edge, index) => stepFromEdge(edge, index + 1, nodes));
}

export function normalizeScenarioSteps<T extends { nodes: ScenarioNode[]; edges: ScenarioEdge[]; steps?: ScenarioStep[]; selectedPath?: string[] }>(scenario: T): T & { steps: ScenarioStep[] } {
  const edgesById = new Map(scenario.edges.map((edge) => [edge.id, edge]));
  const initial = scenario.steps?.length
    ? [...scenario.steps]
    : scenario.selectedPath?.length
      ? scenario.selectedPath.map((edgeId, index) => {
          const edge = edgesById.get(edgeId);
          return edge ? stepFromEdge(edge, index + 1, scenario.nodes) : undefined;
        }).filter((step): step is ScenarioStep => Boolean(step))
      : buildMagicSteps(scenario.edges, scenario.nodes);
  const seen = new Set<string>();
  const normalized = initial
    .filter((step) => edgesById.has(step.edgeId) && !seen.has(step.id) && seen.add(step.id))
    .map((step, index) => {
      const edge = edgesById.get(step.edgeId)!;
      const inferred = stepFromEdge(edge, index + 1, scenario.nodes);
      return {
        ...inferred,
        ...step,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        order: index + 1,
        status: step.status ?? "idle"
      };
    });
  for (const edge of scenario.edges) {
    if (!normalized.some((step) => step.edgeId === edge.id)) {
      normalized.push({ ...stepFromEdge(edge, normalized.length + 1, scenario.nodes), status: "idle" });
    }
  }
  return { ...scenario, steps: normalized };
}

export function renumberSteps(steps: ScenarioStep[]): ScenarioStep[] {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}
