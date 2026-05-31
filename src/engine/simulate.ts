import type { TokenArtifact } from "../model/auth";
import type { TimelineEvent, PolicyDecision } from "../model/events";
import type { SecurityFinding } from "../model/findings";
import type {
  AgentCoreGatewayNode,
  AgentCoreIdentityNode,
  AgentCoreMcpServerNode,
  AgentCoreRuntimeAgentNode,
  AuthorizationServerNode,
  ClientAppNode,
  ExternalApiNode,
  ExternalGenAiAgentNode,
  ExternalMcpServerNode,
  PolicyEngineNode,
  ScenarioNode,
  UserNode
} from "../model/nodes";
import type { MutationConfig, Scenario, SimulationInput, SimulationResult } from "../model/schema";
import type { ScenarioEdge } from "../model/edges";
import type { ScenarioStep } from "../model/steps";
import { normalizeScenarioSteps } from "../model/steps";
import { directA2AEvents } from "./steps/a2a";
import { forwardedOAuthContextEvent, gatewayToolCallEvent, gatewayToolsListEvent } from "./steps/gateway";
import { identityOutboundOauthEvents, workloadTokenEvent } from "./steps/identity";
import { directMcpCallEvent, targetMcpCallEvent } from "./steps/mcp";
import { oauthPkceEvents } from "./steps/oauth";
import { evaluatePolicies, filterPotentiallyAllowedTools } from "./steps/policy";
import { runtimeInvocationEvent } from "./steps/runtime";
import { createSigV4Headers, sigv4Passed, validateSigV4 } from "./steps/sigv4";
import { createMockAccessToken, validateTokenAgainstAuth } from "./token/jwt";
import { tokenValidationPassed } from "./token/validators";
import { finding, uniqueFindings } from "./findings/securityVerdict";

function first<T extends ScenarioNode>(scenario: Scenario, type: T["type"], id?: string): T {
  const node = scenario.nodes.find((item) => item.type === type && (!id || item.id === id));
  if (!node) throw new Error(`Scenario ${scenario.id} is missing ${type}${id ? `:${id}` : ""}`);
  return node as T;
}

function nodes<T extends ScenarioNode>(scenario: Scenario, type: T["type"]): T[] {
  return scenario.nodes.filter((item) => item.type === type) as T[];
}

function activeMutationIds(mutations: MutationConfig[]): Set<string> {
  return new Set(mutations.filter((mutation) => mutation.enabled).map((mutation) => mutation.id));
}

function statusFromEvents(events: TimelineEvent[]): SimulationResult["status"] {
  if (events.some((event) => event.verdict.outcome === "deny")) return "failed";
  if (events.some((event) => event.verdict.outcome === "warn")) return "partial";
  return "success";
}

function addAuthFindings(findings: SecurityFinding[], event: TimelineEvent): void {
  const validation = event.token?.validation;
  if (!validation || tokenValidationPassed(validation)) return;
  if (!validation.audienceValid) {
    findings.push(
      finding({
        type: "wrong_audience",
        severity: "high",
        title: "Audience mismatch",
        explanation: "The token was issued for a different resource server and cannot be replayed to AgentCore Runtime.",
        affectedNodes: [event.targetNodeId],
        remediation: "Issue a token with an audience that matches the runtime inbound authorizer."
      })
    );
  }
  if (!validation.issuerValid) {
    findings.push(
      finding({
        type: "wrong_issuer",
        severity: "high",
        title: "Issuer mismatch",
        explanation: "The JWT issuer is not in the runtime allowed issuer list.",
        affectedNodes: [event.targetNodeId],
        remediation: "Configure the correct OIDC issuer or reject the request."
      })
    );
  }
  if (!validation.expiryValid) {
    findings.push(
      finding({
        type: "expired_token",
        severity: "medium",
        title: "Expired token",
        explanation: "The access token expiry is before the simulation clock.",
        affectedNodes: [event.targetNodeId],
        remediation: "Refresh the token before invoking the runtime."
      })
    );
  }
  if (!validation.scopesValid) {
    findings.push(
      finding({
        type: "missing_scope",
        severity: "medium",
        title: "Missing scope",
        explanation: "The token does not include every scope required by the target authorizer.",
        affectedNodes: [event.targetNodeId],
        remediation: "Request the minimum required scope set during authorization."
      })
    );
  }
}

async function buildUserToken(args: {
  scenario: Scenario;
  user: UserNode;
  client: ClientAppNode;
  idp: AuthorizationServerNode;
  runtime: AgentCoreRuntimeAgentNode;
  mutations: Set<string>;
}): Promise<TokenArtifact> {
  const scopes = args.mutations.has("missing_scope") ? ["openid", "profile"] : ["openid", "profile", "agent.invoke"];
  const token = await createMockAccessToken({
    issuer: args.mutations.has("wrong_issuer") ? "https://issuer.example.invalid" : args.idp.issuer,
    audience: args.mutations.has("wrong_audience") ? "https://www.googleapis.com/drive/v3" : args.runtime.inboundAuth.allowedAudiences?.[0] ?? "agentcore-runtime:default",
    clientId: args.client.clientId,
    subject: args.mutations.has("change_subject_bob") ? "user-bob" : args.user.id,
    scopes,
    resource: args.mutations.has("wrong_audience") ? "https://www.googleapis.com/drive/v3" : args.runtime.inboundAuth.allowedAudiences?.[0] ?? "agentcore-runtime:default",
    authorizationDetails: [
      {
        type: "agentcore_runtime",
        locations: [args.runtime.runtimeArn],
        actions: ["agent.invoke"]
      }
    ],
    tenant: args.mutations.has("change_tenant_claim") ? "other-tenant" : args.user.tenant,
    groups: args.user.groups,
    lifetimeSeconds: args.mutations.has("expire_token") ? -60 : args.idp.tokenLifetimeSeconds
  });
  const validated = await validateTokenAgainstAuth(token.compact, args.runtime.inboundAuth);
  return { ...token, validation: validated.validation, claims: validated.artifact?.claims ?? token.claims };
}

async function buildGatewayToken(args: {
  user: UserNode;
  idp: AuthorizationServerNode;
  gateway: AgentCoreGatewayNode;
}): Promise<TokenArtifact> {
  const token = await createMockAccessToken({
    issuer: args.idp.issuer,
    audience: args.gateway.inboundAuth.allowedAudiences?.[0] ?? "agentcore-gateway:enterprise-tools",
    clientId: args.gateway.inboundAuth.allowedClients?.[0] ?? "agent-runtime-client",
    subject: args.user.id,
    scopes: ["mcp.tools.list", "mcp.tools.call"],
    resource: args.gateway.inboundAuth.allowedAudiences?.[0] ?? "agentcore-gateway:enterprise-tools",
    authorizationDetails: [
      {
        type: "mcp",
        locations: [args.gateway.gatewayUrl],
        actions: ["tools/list", "tools/call"]
      }
    ],
    tenant: args.user.tenant,
    groups: args.user.groups
  });
  const validated = await validateTokenAgainstAuth(token.compact, args.gateway.inboundAuth);
  return { ...token, label: "GATEWAY_ACCESS_TOKEN_SIMULATED", validation: validated.validation, claims: validated.artifact?.claims ?? token.claims };
}

function makePolicyEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  gateway: AgentCoreGatewayNode;
  policyEngine: PolicyEngineNode;
  decision: PolicyDecision;
  action: string;
}): TimelineEvent {
  return {
    id: `policy-${args.action}`,
    index: args.index,
    title: "Gateway policy evaluation",
    sourceNodeId: args.gateway.id,
    targetNodeId: args.policyEngine.id,
    protocol: "Policy",
    method: "EVALUATE",
    url: `local-policy://${args.policyEngine.id}/${args.action}`,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { body: { action: args.action, mode: args.decision.mode } },
    response: { status: args.decision.effect === "deny" && args.decision.mode === "ENFORCE" ? 403 : 200, body: args.decision },
    policyDecision: args.decision,
    verdict: {
      outcome: args.decision.effect === "deny" && args.decision.mode === "ENFORCE" ? "deny" : args.decision.defaultDeny ? "warn" : "allow",
      reason: args.decision.explanation,
      securityNotes: [args.decision.defaultDeny ? "Default deny was reached." : "Policy evaluation is explicit and inspectable."]
    }
  };
}

function gatewayToRuntimeSigV4Event(args: {
  index: number;
  traceId: string;
  correlationId: string;
  gateway: AgentCoreGatewayNode;
  target: AgentCoreRuntimeAgentNode;
  userToken?: TokenArtifact;
  forwardedOAuthTokenHeader?: string;
  mutations: Set<string>;
}): TimelineEvent {
  const path = `/runtimes/${encodeURIComponent(args.target.runtimeArn)}/invocations?qualifier=${args.target.qualifier}`;
  const host = "bedrock-agentcore.us-west-2.amazonaws.com";
  const body = { prompt: "Review policy implications for the planned Workday tool call." };
  const sigv4 = validateSigV4({
    method: "POST",
    host,
    path,
    body,
    auth: args.target.inboundAuth,
    action: "bedrock-agentcore:InvokeAgentRuntime",
    resource: args.target.runtimeArn,
    mutations: args.mutations
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": args.target.session.runtimeSessionId,
    "X-Amzn-Trace-Id": args.traceId,
    "X-Correlation-Id": args.correlationId,
    ...createSigV4Headers({
      method: "POST",
      host,
      path,
      body,
      auth: args.target.inboundAuth,
      action: "bedrock-agentcore:InvokeAgentRuntime",
      resource: args.target.runtimeArn,
      mutations: args.mutations
    })
  };
  const header = args.forwardedOAuthTokenHeader ?? args.target.inboundAuth.forwardedOAuthToken?.headerName ?? "X-AgentCore-Forwarded-OAuth-Token";
  if (!args.mutations.has("forwarded_oauth_header_missing")) headers[header] = "ACCESS_TOKEN_SIMULATED";
  if (args.mutations.has("sigv4_missing_authorization")) delete headers.Authorization;
  const ok = sigv4Passed(sigv4);
  return {
    id: "gateway-runtime-sigv4",
    index: args.index,
    title: "Gateway proxies to Runtime with SigV4",
    sourceNodeId: args.gateway.id,
    targetNodeId: args.target.id,
    protocol: "SigV4",
    method: "POST",
    url: `https://${host}${path}`,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { headers, body },
    response: ok
      ? { status: 200, body: { result: "PolicyReviewAgent accepted Gateway-mediated request.", auth: "AWS_IAM_SIGV4" } }
      : { status: 403, body: { code: "ACCESS_DENIED", message: sigv4.errors.join(" ") } },
    sigv4,
    token: args.userToken ? { ...args.userToken, label: "FORWARDED_ACCESS_TOKEN_SIMULATED", kind: "forwarded-user-context" } : undefined,
    verdict: {
      outcome: ok ? "allow" : "deny",
      reason: ok ? "Gateway signed the target runtime invocation with SigV4." : "SigV4 validation failed at the target runtime.",
      securityNotes: [
        "SigV4 failures return 403 and do not include WWW-Authenticate.",
        "The custom OAuth header preserves user context for application-level checks; it is not the primary runtime authorizer."
      ]
    }
  };
}

function buildMermaid(events: TimelineEvent[], scenario: Scenario): string {
  const ids = Array.from(new Set(events.flatMap((event) => [event.sourceNodeId, event.targetNodeId])));
  const participants = ids.map((id) => {
    const label = scenario.nodes.find((node) => node.id === id)?.displayName ?? id;
    const alias = id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "N";
    return { id, alias, label };
  });
  const aliasFor = (id: string) => participants.find((p) => p.id === id)?.alias ?? id;
  return [
    "sequenceDiagram",
    ...participants.map((p) => `  participant ${p.alias} as ${p.label}`),
    ...events.map((event) => `  ${aliasFor(event.sourceNodeId)}->>${aliasFor(event.targetNodeId)}: ${event.title}`)
  ].join("\n");
}

function buildCurl(event: TimelineEvent): string | undefined {
  if (!event.method || !event.url || event.method === "EVALUATE") return undefined;
  const headers = Object.entries(event.request.headers ?? {})
    .map(([key, value]) => `  -H "${key}: ${String(value).replace(/"/g, '\\"')}"`)
    .join(" \\\n");
  const body = event.request.body ? ` \\\n  -d '${JSON.stringify(event.request.body).replace(/'/g, "'\\''")}'` : "";
  return [`curl -X ${event.method} "${event.url}"`, headers, body].filter(Boolean).join(" \\\n");
}

function isAgentCoreTarget(node: ScenarioNode): boolean {
  return node.type === "agentcore_gateway" || node.type === "agentcore_runtime_agent" || node.type === "agentcore_mcp_server";
}

function dynamicAction(edge: ScenarioEdge): string {
  if (edge.kind.includes("gateway")) return "bedrock-agentcore:InvokeGateway";
  if (edge.kind.includes("runtime") || edge.kind.includes("a2a")) return "bedrock-agentcore:InvokeAgentRuntime";
  if (edge.kind.includes("external_api")) return "execute-api:Invoke";
  return "mcp:CallTool";
}

function dynamicResource(target: ScenarioNode): string {
  if (target.type === "agentcore_gateway") return target.gatewayArn;
  if (target.type === "agentcore_runtime_agent" || target.type === "agentcore_mcp_server") return target.runtimeArn;
  if (target.type === "external_api") return target.endpoint;
  if (target.type === "external_mcp_server") return target.endpoint;
  return target.id;
}

function dynamicHostAndPath(url: string): { host: string; path: string } {
  const parsed = new URL(url);
  return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
}

function syntheticSigV4Auth(edge: ScenarioEdge, source: ScenarioNode, target: ScenarioNode) {
  const targetAuth = "inboundAuth" in target ? target.inboundAuth : undefined;
  if (targetAuth?.sigv4) return targetAuth;
  const principalArn = source.type === "external_genai_agent" ? source.awsPrincipalArn ?? "arn:aws:iam::123456789012:role/ExternalAgentCallerRole" : "arn:aws:iam::123456789012:role/AgentCoreSimulatorRole";
  return {
    mode: "AWS_IAM_SIGV4" as const,
    sigv4: {
      region: "us-west-2",
      service: isAgentCoreTarget(target) ? "bedrock-agentcore" : "execute-api",
      principalArn,
      allowedActions: [dynamicAction(edge)],
      allowedResources: [dynamicResource(target)]
    }
  };
}

function dynamicUrl(edge: ScenarioEdge, target: ScenarioNode): string {
  if (target.type === "agentcore_gateway") return target.gatewayUrl;
  if (target.type === "agentcore_runtime_agent") {
    if (edge.kind === "external_agent_to_runtime_a2a" || edge.kind === "runtime_to_runtime_a2a") return `https://${target.name.toLowerCase()}.runtime.bedrock-agentcore.us-west-2.amazonaws.com/.well-known/agent.json`;
    return `https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/${encodeURIComponent(target.runtimeArn)}/invocations?qualifier=${target.qualifier}`;
  }
  if (target.type === "agentcore_mcp_server") return `https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/${encodeURIComponent(target.runtimeArn)}/invocations?qualifier=DEFAULT`;
  if (target.type === "external_mcp_server" || target.type === "external_api" || target.type === "saas_resource") return target.endpoint;
  if (target.type === "authorization_server") return target.tokenEndpoint ?? `${target.issuer}/protocol/openid-connect/token`;
  return `local://${target.id}`;
}

function dynamicProtocol(edge: ScenarioEdge, target: ScenarioNode): TimelineEvent["protocol"] {
  if (edge.kind.includes("authorization_server") || target.type === "authorization_server") return "OAuth2";
  if (edge.kind.includes("a2a")) return "A2A";
  if (edge.kind.includes("mcp") || target.type === "agentcore_gateway" || target.type === "agentcore_mcp_server" || target.type === "external_mcp_server") return "MCP";
  return "HTTP";
}

function dynamicTitle(edge: ScenarioEdge, source: ScenarioNode, target: ScenarioNode): string {
  const sourceName = source.displayName ?? ("name" in source ? String(source.name) : source.id);
  const targetName = target.displayName ?? ("name" in target ? String(target.name) : target.id);
  const titles: Partial<Record<ScenarioEdge["kind"], string>> = {
    client_to_gateway_mcp: "Client app calls Gateway as MCP resource server",
    client_to_external_api: "Client app calls protected API",
    external_agent_to_authorization_server: "External agent obtains OAuth token",
    external_agent_to_gateway_mcp: "External agent calls AgentCore Gateway",
    external_agent_to_mcp_direct: "External agent calls MCP server",
    external_agent_to_runtime_http: "External agent invokes AgentCore Runtime",
    external_agent_to_runtime_a2a: "External agent discovers A2A runtime",
    external_agent_to_external_api: "External agent calls protected API",
    runtime_to_external_api: "Runtime calls external API directly",
    gateway_to_external_api_target: "Gateway calls external API target"
  };
  return titles[edge.kind] ?? `${sourceName} -> ${targetName}`;
}

function dynamicRequestBody(edge: ScenarioEdge, source: ScenarioNode, target: ScenarioNode): unknown {
  if (edge.kind.includes("authorization_server")) {
    const clientId = source.type === "external_genai_agent" ? source.oauthClientId ?? "external-agent-client" : "client-simulated";
    return `grant_type=client_credentials&client_id=${clientId}&scope=mcp.tools.call`;
  }
  if (edge.kind.includes("mcp") || target.type === "agentcore_gateway" || target.type === "agentcore_mcp_server" || target.type === "external_mcp_server") {
    return { jsonrpc: "2.0", id: `dynamic-${edge.id}`, method: "tools/list" };
  }
  if (edge.kind.includes("a2a")) return undefined;
  return { operation: "invoke", requestedBy: source.id, target: target.id };
}

function dynamicAuth(args: {
  edge: ScenarioEdge;
  source: ScenarioNode;
  target: ScenarioNode;
  method: string;
  url: string;
  body: unknown;
  traceId: string;
  correlationId: string;
  mutations: Set<string>;
}): Pick<TimelineEvent, "sigv4"> & { headers: Record<string, string>; allowed: boolean; notes: string[] } {
  const headers: Record<string, string> = {
    "X-Amzn-Trace-Id": args.traceId,
    "X-Correlation-Id": args.correlationId
  };
  if (args.method !== "GET") headers["Content-Type"] = args.edge.kind.includes("authorization_server") ? "application/x-www-form-urlencoded" : "application/json";
  if (dynamicProtocol(args.edge, args.target) === "MCP") headers.Accept = "application/json, text/event-stream";
  if (args.target.type === "agentcore_mcp_server") headers["Mcp-Session-Id"] = "mcp-session-000000000001";

  if (args.edge.authMode === "AWS_IAM_SIGV4") {
    const { host, path } = dynamicHostAndPath(args.url);
    const auth = syntheticSigV4Auth(args.edge, args.source, args.target);
    const sigv4 = validateSigV4({
      method: args.method,
      host,
      path,
      body: args.body ?? {},
      auth,
      action: dynamicAction(args.edge),
      resource: dynamicResource(args.target),
      mutations: args.mutations
    });
    Object.assign(headers, createSigV4Headers({ method: args.method, host, path, body: args.body ?? {}, auth, action: dynamicAction(args.edge), resource: dynamicResource(args.target), mutations: args.mutations }));
    if (args.edge.forwardedOAuthTokenHeader && !args.mutations.has("forwarded_oauth_header_missing")) headers[args.edge.forwardedOAuthTokenHeader] = "ACCESS_TOKEN_SIMULATED";
    if (args.mutations.has("sigv4_missing_authorization")) delete headers.Authorization;
    return {
      headers,
      sigv4,
      allowed: sigv4Passed(sigv4),
      notes: [
        "Primary authentication is AWS SigV4 request signing.",
        args.edge.forwardedOAuthTokenHeader ? `Original OAuth context is carried in ${args.edge.forwardedOAuthTokenHeader}.` : "No OAuth user context header is forwarded on this SigV4 request."
      ]
    };
  }
  if (args.edge.authMode === "OAUTH_JWT") {
    headers.Authorization = "Bearer ACCESS_TOKEN_SIMULATED";
    return {
      headers,
      allowed: true,
      notes: ["Primary authentication is OAuth/JWT bearer. Validate issuer, audience, client and scopes at the protected resource."]
    };
  }
  return {
    headers,
    allowed: true,
    notes: ["No authentication is configured. This may be acceptable only for isolated test resources."]
  };
}

function dynamicTopologyEvent(args: {
  edge: ScenarioEdge;
  index: number;
  traceId: string;
  correlationId: string;
  scenario: Scenario;
  mutations: Set<string>;
}): TimelineEvent | undefined {
  const source = args.scenario.nodes.find((node) => node.id === args.edge.source);
  const target = args.scenario.nodes.find((node) => node.id === args.edge.target);
  if (!source || !target || args.edge.invalid) return undefined;
  const base = {
    index: args.index,
    edgeId: args.edge.id,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    traceId: args.traceId,
    correlationId: args.correlationId
  };
  if (args.edge.kind === "user_to_client") {
    const client = target as ClientAppNode;
    return {
      ...base,
      id: `topology-user-client-${args.edge.id}`,
      title: "User opens client application",
      protocol: "HTTP",
      method: "GET",
      url: client.redirectUri.replace("/callback", "/"),
      request: { headers: { "X-Correlation-Id": args.correlationId }, body: undefined },
      response: { status: 200, body: { app: client.clientId, next: "START_AUTHORIZATION_CODE_PKCE" } },
      verdict: {
        outcome: "info",
        reason: "The human user reaches the client app before the OAuth authorization request.",
        securityNotes: ["No access token exists yet; the client must initiate authorization before invoking protected resources."]
      }
    };
  }
  if (args.edge.kind === "identity_to_authorization_server" || args.edge.kind === "authorization_server_to_identity") {
    const identity = (source.type === "agentcore_identity" ? source : target.type === "agentcore_identity" ? target : undefined) as AgentCoreIdentityNode | undefined;
    const idp = (source.type === "authorization_server" ? source : target.type === "authorization_server" ? target : undefined) as AuthorizationServerNode | undefined;
    const provider = identity?.credentialProviders.find((item) => item.name === args.edge.credentialProviderName) ?? identity?.credentialProviders[0];
    if (!identity || !idp || !provider) return undefined;
    return {
      ...base,
      id: `topology-provider-${args.edge.id}`,
      title: args.edge.kind === "authorization_server_to_identity" ? "Keycloak provider callback to Identity" : "Identity provider relation to Keycloak",
      protocol: "OAuth2",
      method: "BIND",
      url: provider.tokenEndpoint ?? idp.tokenEndpoint ?? `${idp.issuer}/protocol/openid-connect/token`,
      request: {
        headers: { "X-Correlation-Id": args.correlationId },
        body: {
          providerName: provider.name,
          flow: provider.flow,
          authorizationServerId: provider.authorizationServerId ?? idp.id,
          direction: args.edge.kind
        }
      },
      response: {
        status: 200,
        body: {
          providerRecognized: true,
          pepResource: `provider:${provider.name}`,
          tokenEndpoint: provider.tokenEndpoint ?? idp.tokenEndpoint
        }
      },
      verdict: {
        outcome: "info",
        reason: "The topology includes an explicit credential-provider relationship between AgentCore Identity and the authorization server.",
        securityNotes: [
          "Each edge represents a distinct provider relationship and can coexist with other providers.",
          "Provider selection is evaluated later by Identity PEP when a WAT-bound request asks for a downstream token."
        ]
      }
    };
  }
  if (args.edge.kind === "runtime_to_authorization_server") {
    const runtime = source as AgentCoreRuntimeAgentNode;
    const idp = target as AuthorizationServerNode;
    return {
      ...base,
      id: `topology-runtime-as-${args.edge.id}`,
      title: "Runtime code calls authorization server",
      protocol: "OAuth2",
      method: "POST",
      url: idp.tokenEndpoint ?? `${idp.issuer}/protocol/openid-connect/token`,
      request: {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Correlation-Id": args.correlationId
        },
        body: "grant_type=client_credentials&client_id=runtime-code-client&scope=agent.internal"
      },
      response: {
        status: 200,
        body: {
          access_token: "RUNTIME_CODE_TOKEN_SIMULATED",
          token_type: "Bearer",
          issued_to: runtime.workloadIdentity.name
        }
      },
      verdict: {
        outcome: "warn",
        reason: "Runtime code can reach the IdP/AS directly, but this path is separate from AgentCore Identity provider mediation.",
        securityNotes: [
          "Keep runtime-owned OAuth clients separate from Identity-managed resource providers.",
          "Audit client credentials and avoid mixing user-delegated semantics with autonomous runtime credentials."
        ]
      }
    };
  }
  if (args.edge.kind === "gateway_to_authorization_server_interceptor") {
    const gateway = source as AgentCoreGatewayNode;
    const idp = target as AuthorizationServerNode;
    return {
      ...base,
      id: `topology-gateway-as-interceptor-${args.edge.id}`,
      title: "Gateway Lambda interceptor calls authorization server",
      protocol: "OAuth2",
      method: "POST",
      url: `${idp.issuer}/protocol/openid-connect/token/introspect`,
      request: {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-AgentCore-Gateway-Arn": gateway.gatewayArn,
          "X-Correlation-Id": args.correlationId
        },
        body: "token=ACCESS_TOKEN_SIMULATED&token_type_hint=access_token"
      },
      response: {
        status: 200,
        body: { active: true, iss: idp.issuer, aud: gateway.inboundAuth.allowedAudiences?.[0] ?? "agentcore-gateway:enterprise-tools" }
      },
      verdict: {
        outcome: "info",
        reason: "A Gateway request interceptor can call the IdP/AS before routing to targets.",
        securityNotes: [
          "The interceptor decision is separate from Gateway target policy enforcement.",
          "Do not leak bearer tokens in logs; cache introspection results conservatively."
        ]
      }
    };
  }
  const dynamicKinds = new Set<ScenarioEdge["kind"]>([
    "client_to_gateway_mcp",
    "client_to_external_api",
    "external_agent_to_authorization_server",
    "external_agent_to_gateway_mcp",
    "external_agent_to_mcp_direct",
    "external_agent_to_runtime_http",
    "external_agent_to_runtime_a2a",
    "external_agent_to_external_api",
    "runtime_to_external_api",
    "gateway_to_external_api_target"
  ]);
  if (dynamicKinds.has(args.edge.kind)) {
    const url = dynamicUrl(args.edge, target);
    const method = args.edge.kind.includes("a2a") ? "GET" : "POST";
    const body = dynamicRequestBody(args.edge, source, target);
    const auth = dynamicAuth({ edge: args.edge, source, target, method, url, body, traceId: args.traceId, correlationId: args.correlationId, mutations: args.mutations });
    const unauthenticated = args.edge.authMode === "NONE";
    const blocked = args.edge.authMode === "AWS_IAM_SIGV4" && !auth.allowed;
    const warned = unauthenticated || args.edge.kind === "runtime_to_external_api" || (args.edge.kind === "external_agent_to_mcp_direct" && target.type === "external_mcp_server");
    return {
      ...base,
      id: `topology-connectivity-${args.edge.id}`,
      title: dynamicTitle(args.edge, source, target),
      protocol: dynamicProtocol(args.edge, target),
      method,
      url,
      request: { headers: auth.headers, body },
      response: blocked
        ? { status: 403, body: { code: "ACCESS_DENIED", message: auth.sigv4?.errors.join(" ") } }
        : { status: method === "GET" ? 200 : 200, body: { accepted: true, edgeKind: args.edge.kind, authMode: args.edge.authMode ?? "NONE", target: target.id } },
      sigv4: auth.sigv4,
      verdict: {
        outcome: blocked ? "deny" : warned ? "warn" : "allow",
        reason: blocked
          ? "SigV4 validation failed for this topology edge."
          : unauthenticated
            ? "The connection is reachable but has no primary authentication configured."
            : "The connection is reachable with the selected protocol and authentication mode.",
        securityNotes: [
          ...auth.notes,
          args.edge.kind === "client_to_gateway_mcp" ? "A client application can act as a technical MCP client to Gateway when explicitly modeled and authorized." : "",
          args.edge.kind === "external_agent_to_gateway_mcp" ? "External GenAI agents can treat Gateway as their MCP resource server when OAuth or SigV4 is configured." : "",
          args.edge.kind === "external_agent_to_mcp_direct" ? "Direct external-agent-to-MCP calls bypass AgentCore Gateway policy unless routed through Gateway." : "",
          args.edge.kind === "gateway_to_external_api_target" ? "Gateway models the external API as a governed target exposed to agents as tools." : "",
          args.edge.kind === "runtime_to_external_api" ? "Runtime direct API calls reduce central Gateway policy and credential mediation." : ""
        ].filter(Boolean)
      }
    };
  }
  return undefined;
}

function appendDynamicTopologyEvents(args: {
  scenario: Scenario;
  events: TimelineEvent[];
  traceId: string;
  correlationId: string;
  mutations: Set<string>;
  steps?: ScenarioStep[];
}): void {
  const dynamicKinds = new Set<ScenarioEdge["kind"]>([
    "identity_to_authorization_server",
    "authorization_server_to_identity",
    "user_to_client",
    "runtime_to_authorization_server",
    "gateway_to_authorization_server_interceptor",
    "client_to_gateway_mcp",
    "client_to_external_api",
    "external_agent_to_authorization_server",
    "external_agent_to_gateway_mcp",
    "external_agent_to_mcp_direct",
    "external_agent_to_runtime_http",
    "external_agent_to_runtime_a2a",
    "external_agent_to_external_api",
    "runtime_to_external_api",
    "gateway_to_external_api_target"
  ]);
  const stepEdgeIds = args.steps?.length ? args.steps.map((step) => step.edgeId) : undefined;
  const edges = stepEdgeIds
    ? stepEdgeIds.map((edgeId) => args.scenario.edges.find((edge) => edge.id === edgeId)).filter((edge): edge is ScenarioEdge => Boolean(edge))
    : args.scenario.edges;
  for (const edge of edges) {
    if (!dynamicKinds.has(edge.kind)) continue;
    const event = dynamicTopologyEvent({ edge, index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, scenario: args.scenario, mutations: args.mutations });
    if (event) args.events.push(event);
  }
}

function eventEdgeId(event: TimelineEvent, scenario: Scenario): string | undefined {
  if (event.edgeId) return event.edgeId;
  if (event.id.startsWith("oauth-")) {
    return scenario.edges.find((edge) => edge.kind === "client_to_idp" || edge.kind === "external_agent_to_authorization_server")?.id;
  }
  if (event.id.startsWith("identity-pep") || event.id.startsWith("identity-resolve-provider") || event.id.startsWith("identity-outbound")) {
    return scenario.edges.find((edge) => edge.kind === "gateway_to_identity")?.id ?? scenario.edges.find((edge) => edge.kind === "runtime_to_identity")?.id;
  }
  const edgesByPair = new Map<string, ScenarioEdge[]>();
  for (const edge of scenario.edges) {
    const key = `${edge.source}->${edge.target}`;
    edgesByPair.set(key, [...(edgesByPair.get(key) ?? []), edge]);
  }
  const matchingEdges = edgesByPair.get(`${event.sourceNodeId}->${event.targetNodeId}`);
  if (!matchingEdges?.length) return undefined;
  if (event.id === "runtime-invoke") return matchingEdges.find((edge) => edge.kind === "client_to_runtime" || edge.kind === "user_to_runtime" || edge.kind === "external_agent_to_runtime_http")?.id;
  if (event.id === "identity-workload-token") return matchingEdges.find((edge) => edge.kind === "runtime_to_identity")?.id;
  if (event.id === "gateway-tools-list" || event.id.startsWith("gateway-tool-call")) return matchingEdges.find((edge) => edge.kind === "runtime_to_gateway_mcp" || edge.kind === "client_to_gateway_mcp" || edge.kind === "external_agent_to_gateway_mcp")?.id;
  if (event.id.startsWith("policy-")) return matchingEdges.find((edge) => edge.kind === "gateway_to_policy_engine")?.id;
  if (event.id.startsWith("identity-as-token")) return matchingEdges.find((edge) => edge.kind === "identity_to_authorization_server" || edge.kind === "authorization_server_to_identity")?.id;
  if (event.id === "direct-mcp-call") return matchingEdges.find((edge) => edge.kind === "runtime_to_mcp_direct" || edge.kind === "external_agent_to_mcp_direct")?.id;
  if (event.id === "a2a-agent-card" || event.id === "a2a-message-send") return matchingEdges.find((edge) => edge.kind === "runtime_to_runtime_a2a" || edge.kind === "external_agent_to_runtime_a2a")?.id;
  if (event.id === "gateway-runtime-sigv4") return matchingEdges.find((edge) => edge.kind === "gateway_to_http_runtime_target")?.id;
  if (event.id.startsWith("target-mcp-call")) return matchingEdges.find((edge) => edge.kind === "gateway_to_mcp_target")?.id;
  return matchingEdges[0]?.id;
}

function eventsForSteps(events: TimelineEvent[], scenario: Scenario, steps: ScenarioStep[]): { events: TimelineEvent[]; steps: ScenarioStep[] } {
  if (!steps.length) return { events: events.map((event, index) => ({ ...event, index: index + 1 })), steps };
  const stepByEdgeId = new Map(steps.map((step) => [step.edgeId, step]));
  const orderedSteps = [...steps].sort((a, b) => a.order - b.order);
  const annotated = events
    .map((event) => {
      const edgeId = eventEdgeId(event, scenario);
      const step = edgeId ? stepByEdgeId.get(edgeId) : undefined;
      return step ? { ...event, edgeId, stepId: step.id } : { ...event, edgeId };
    })
    .filter((event) => !event.edgeId || stepByEdgeId.has(event.edgeId));
  const eventsByStep = new Map<string, TimelineEvent[]>();
  for (const event of annotated) {
    if (!event.stepId) continue;
    eventsByStep.set(event.stepId, [...(eventsByStep.get(event.stepId) ?? []), event]);
  }

  const comparison = scenario.id.includes("direct-vs") || scenario.id.includes("agent-to-agent-direct-vs-gateway");
  let stopped = false;
  const stoppedBranches = new Set<string>();
  const orderedEvents: TimelineEvent[] = [];
  const nextSteps: ScenarioStep[] = [];
  for (const step of orderedSteps) {
    const branch = step.branchId ?? "main";
    const shouldSkip = comparison ? stoppedBranches.has(branch) : stopped;
    const stepEvents = eventsByStep.get(step.id) ?? [];
    if (shouldSkip) {
      nextSteps.push({ ...step, status: "skipped" });
      continue;
    }
    orderedEvents.push(...stepEvents);
    const hasDeny = stepEvents.some((event) => event.verdict.outcome === "deny");
    const hasWarn = stepEvents.some((event) => event.verdict.outcome === "warn");
    const status: ScenarioStep["status"] = hasDeny ? "failed" : hasWarn ? "warning" : stepEvents.length ? "success" : "skipped";
    nextSteps.push({ ...step, status });
    if (hasDeny && step.stopOnFailure !== false) {
      if (comparison) stoppedBranches.add(branch);
      else stopped = true;
    }
  }
  return { events: orderedEvents.map((event, index) => ({ ...event, index: index + 1 })), steps: nextSteps };
}

function forwardedHeaderForEdge(scenario: Scenario, kind: ScenarioEdge["kind"], source: string, target: string): string | undefined {
  return scenario.edges.find((edge) => edge.kind === kind && edge.source === source && edge.target === target)?.forwardedOAuthTokenHeader;
}

function addCommonFindings(args: {
  findings: SecurityFinding[];
  scenario: Scenario;
  events: TimelineEvent[];
  mutations: Set<string>;
}): void {
  for (const event of args.events) addAuthFindings(args.findings, event);
  if (args.events.some((event) => event.id === "direct-mcp-call")) {
    args.findings.push(
      finding({
        type: "direct_tool_call_bypasses_gateway_policy",
        severity: "medium",
        title: "Direct MCP bypasses Gateway controls",
        explanation: "The agent called the MCP server directly, bypassing Gateway policy, semantic tool catalog, centralized audit and target credential mediation.",
        affectedNodes: args.events.filter((event) => event.id === "direct-mcp-call").map((event) => event.targetNodeId),
        remediation: "Route governed tools through AgentCore Gateway unless the topology has a documented low-risk exception."
      })
    );
  }
  if (args.events.some((event) => event.id === "a2a-message-send")) {
    args.findings.push(
      finding({
        type: "direct_agent_call_bypasses_gateway_policy",
        severity: "medium",
        title: "Direct A2A bypasses Gateway policy",
        explanation: "The source agent invoked another runtime directly with A2A, which has less central policy and audit coverage than a Gateway HTTP target.",
        affectedNodes: args.events.filter((event) => event.id === "a2a-message-send").flatMap((event) => [event.sourceNodeId, event.targetNodeId]),
        remediation: "Use Gateway HTTP targets for interactions that require central authorization, audit and enforcement."
      })
    );
  }
  if (args.mutations.has("remove_mcp_session_id") || args.events.some((event) => event.id === "direct-mcp-call" && !event.request.headers?.["Mcp-Session-Id"])) {
    args.findings.push(
      finding({
        type: "mcp_session_id_missing",
        severity: "low",
        title: "Mcp-Session-Id missing or changed",
        explanation: "Stateful MCP requests without the same session id may route to a new microVM, lose state or increase cold-start latency.",
        affectedNodes: args.events.filter((event) => event.id === "direct-mcp-call").map((event) => event.targetNodeId),
        remediation: "Reuse the server-issued Mcp-Session-Id for stateful MCP sessions."
      })
    );
  }
  if (args.events.some((event) => event.id === "gateway-forwarded-oauth-context" && event.verdict.outcome === "info")) {
    args.findings.push(
      finding({
        type: "forwarded_oauth_context_header",
        severity: "info",
        title: "SigV4 request carries OAuth user context",
        explanation: "The request is authenticated with SigV4 while the original OAuth token is carried in an explicitly configured custom header for user-context validation.",
        affectedNodes: args.events.filter((event) => event.id === "gateway-forwarded-oauth-context").map((event) => event.targetNodeId),
        remediation: "Allowlist the header, validate the token, redact it from logs and do not treat it as primary authentication."
      })
    );
  }
  if (args.events.some((event) => event.sigv4 && !sigv4Passed(event.sigv4))) {
    args.findings.push(
      finding({
        type: "sigv4_auth_failed",
        severity: "high",
        title: "SigV4 validation failed",
        explanation: "The simulated SigV4 request failed signature, scope, clock, principal, action or resource validation.",
        affectedNodes: args.events.filter((event) => event.sigv4 && !sigv4Passed(event.sigv4)).map((event) => event.targetNodeId),
        remediation: "Sign the request for the correct region/service and grant the calling role the minimum required AgentCore action on the target ARN."
      })
    );
  }
}

export async function simulateScenario(input: SimulationInput): Promise<SimulationResult> {
  const scenario = normalizeScenarioSteps(input.scenario);
  const mutationSet = activeMutationIds(input.mutations);
  const steps = input.steps?.length ? input.steps : scenario.steps ?? [];
  const events: TimelineEvent[] = [];
  const findings: SecurityFinding[] = [];
  const traceId = `trace-${scenario.id}-0001`;
  const correlationId = `corr-${scenario.id}-0001`;
  for (const edge of scenario.edges.filter((item) => item.invalid)) {
    findings.push(
      finding({
        type: "invalid_topology_edge",
        severity: "high",
        title: "Invalid topology connection",
        explanation: edge.invalidReason ?? `The connection ${edge.source} -> ${edge.target} is not a legal AgentCore security relationship.`,
        affectedNodes: [edge.source, edge.target],
        remediation: "Edit the line and select a legal relation, or keep it marked red as an explicit design issue to resolve."
      })
    );
  }
  const user = first<UserNode>(scenario, "user");
  const client = first<ClientAppNode>(scenario, "client_app");
  const idp = first<AuthorizationServerNode>(scenario, "authorization_server");
  const runtime = first<AgentCoreRuntimeAgentNode>(scenario, "agentcore_runtime_agent");
  const identity = first<AgentCoreIdentityNode>(scenario, "agentcore_identity");
  const gateways = nodes<AgentCoreGatewayNode>(scenario, "agentcore_gateway");
  const gateway = gateways[0];
  const policyEngine = nodes<PolicyEngineNode>(scenario, "policy_engine")[0];
  const userToken = await buildUserToken({ scenario, user, client, idp, runtime, mutations: mutationSet });
  const gatewayToken = gateway ? await buildGatewayToken({ user, idp, gateway }) : undefined;

  const oauthEvents = oauthPkceEvents({
    base: { index: 1, traceId, correlationId },
    user,
    client,
    idp,
    token: userToken,
    scopes: ["openid", "profile", "agent.invoke"],
    resource: runtime.inboundAuth.allowedAudiences?.[0] ?? runtime.runtimeArn,
    authorizationDetails: [
      {
        type: "agentcore_runtime",
        locations: [runtime.runtimeArn],
        actions: ["agent.invoke"]
      }
    ]
  });
  events.push(...oauthEvents);

  const runtimeEvent = runtimeInvocationEvent({
    index: events.length + 1,
    traceId,
    correlationId,
    client,
    runtime,
    prompt: input.userPrompt || scenario.initialUserPrompt,
    token: userToken,
    removeAuthorization: mutationSet.has("remove_authorization_header")
  });
  events.push(runtimeEvent);
  if (runtimeEvent.verdict.outcome === "deny" || scenario.id === "02-wrong-audience") {
    addCommonFindings({ findings, scenario, events, mutations: mutationSet });
    return finish(scenario, events, findings, steps);
  }

  events.push(
    workloadTokenEvent({
      index: events.length + 1,
      traceId,
      correlationId,
      runtime,
      identity,
      subject: String(userToken.claims?.sub ?? user.id),
      issuer: String(userToken.claims?.iss ?? idp.issuer)
    })
  );
  appendDynamicTopologyEvents({ scenario, events, traceId, correlationId, mutations: mutationSet, steps });

  if (scenario.id === "01-google-drive-obo") {
    runGoogleDriveScenario({ scenario, events, findings, mutationSet, traceId, correlationId, runtime, identity, authorizationServer: idp, gateway, gatewayToken, userToken, user, policyEngine });
  } else if (scenario.id === "03-workday-policy-deny") {
    runWorkdayScenario({ scenario, events, findings, traceId, correlationId, runtime, gateway, gatewayToken, userToken, user, policyEngine });
  } else if (scenario.id === "04-direct-vs-gateway-mcp") {
    runDirectVsGatewayMcpScenario({ scenario, events, findings, mutationSet, traceId, correlationId, runtime, identity, authorizationServer: idp, gateway, gatewayToken, userToken, user, policyEngine });
  } else if (scenario.id === "05-agent-to-agent-direct-vs-gateway") {
    runA2AScenario({ scenario, events, findings, mutationSet, traceId, correlationId, runtime, gateway, gatewayToken, userToken, user, policyEngine });
  }

  addCommonFindings({ findings, scenario, events, mutations: mutationSet });
  return finish(scenario, events, findings, steps);
}

function runGoogleDriveScenario(args: {
  scenario: Scenario;
  events: TimelineEvent[];
  findings: SecurityFinding[];
  mutationSet: Set<string>;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  identity: AgentCoreIdentityNode;
  authorizationServer: AuthorizationServerNode;
  gateway: AgentCoreGatewayNode;
  gatewayToken?: TokenArtifact;
  userToken: TokenArtifact;
  user: UserNode;
  policyEngine: PolicyEngineNode;
}): void {
  const google = first<ExternalMcpServerNode>(args.scenario, "external_mcp_server", "external-google-drive");
  const tools = google.tools;
  const listed = filterPotentiallyAllowedTools(args.policyEngine.policies, args.runtime.workloadIdentity.name, tools);
  args.events.push(
    gatewayToolsListEvent({
      index: args.events.length + 1,
      traceId: args.traceId,
      correlationId: args.correlationId,
      runtime: args.runtime,
      gateway: args.gateway,
      tools: listed.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
      authMode: "OAUTH_JWT",
      token: args.gatewayToken,
      mutations: args.mutationSet
    })
  );
  const decision = evaluatePolicies({
    engineId: args.policyEngine.id,
    mode: args.policyEngine.mode,
    policies: args.policyEngine.policies,
    principal: args.runtime.workloadIdentity.name,
    action: "google_drive.search_files",
    resource: google.id,
    context: {
      principal: { id: args.runtime.workloadIdentity.name, department: args.user.department },
      context: { user: args.user, scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.metadata.readonly"] },
      arguments: { query: "receipts" }
    }
  });
  args.events.push(makePolicyEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, gateway: args.gateway, policyEngine: args.policyEngine, decision, action: "google_drive.search_files" }));
  args.events.push(gatewayToolCallEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, runtime: args.runtime, gateway: args.gateway, toolName: "google_drive.search_files", policyDecision: decision }));
  const flow = args.mutationSet.has("autonomous_credential") ? "CLIENT_CREDENTIALS" : "ON_BEHALF_OF_TOKEN_EXCHANGE";
  const providerName = flow === "CLIENT_CREDENTIALS" ? "google-drive-service" : "google-drive-obo";
  const requestedScopes = args.mutationSet.has("token_exchange_extra_scope")
    ? ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"]
    : ["https://www.googleapis.com/auth/drive.readonly"];
  args.events.push(
    ...identityOutboundOauthEvents({
      index: args.events.length + 1,
      traceId: args.traceId,
      correlationId: args.correlationId,
      gateway: args.gateway,
      identity: args.identity,
      authorizationServer: args.authorizationServer,
      providerName,
      flow,
      scopes: requestedScopes,
      requestedResource: "https://www.googleapis.com/drive/v3",
      tokenStrategy: args.mutationSet.has("token_exchange_extra_scope")
        ? "TOKEN_EXCHANGE_REQUESTED_PERMISSIONS"
        : flow === "CLIENT_CREDENTIALS"
          ? "SCOPED_CLIENT_TOKEN"
          : "OBO_TOKEN_EXCHANGE",
      actor: args.runtime.workloadIdentity.name,
      subject: String(args.userToken.claims?.sub ?? args.user.id)
    })
  );
  if (args.mutationSet.has("token_exchange_extra_scope")) {
    args.findings.push(
      finding({
        type: "token_exchange_scope_escalation_denied",
        severity: "high",
        title: "Token exchange requested ungranted downstream scope",
        explanation: "The actor requested a new downstream permission during token exchange that is outside the credential provider/client grant. The authorization server denies the requested scope instead of silently expanding authority.",
        affectedNodes: [args.identity.id, args.authorizationServer.id],
        remediation: "Declare allowed resources/scopes per credential provider and require policy review for any token-exchange scope expansion."
      })
    );
  } else if (flow === "CLIENT_CREDENTIALS") {
    args.findings.push(
      finding({
        type: "scoped_client_token_used",
        severity: "medium",
        title: "Scoped client token used without user subject",
        explanation: "Identity requested a scoped client token for the actor/client rather than an OBO token. This is valid for autonomous actions but does not preserve the user subject.",
        affectedNodes: [args.identity.id, google.id],
        remediation: "Use this path only for service-owned actions; use OBO when the action represents a human user's resource access."
      })
    );
  }
  args.events.push(targetMcpCallEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, sourceId: args.gateway.id, target: google, toolName: "google_drive.search_files" }));
  args.findings.push(
    finding({
      type: flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "obo_preserves_user_context" : "autonomous_credential_used_for_user_action",
      severity: flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "info" : "high",
      title: flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "OBO preserves user context" : "Autonomous credential used for user action",
      explanation:
        flow === "ON_BEHALF_OF_TOKEN_EXCHANGE"
          ? "The downstream token preserves both user identity and agent workload identity."
          : "The action appears user-directed but the downstream credential has no user binding.",
      affectedNodes: [args.gateway.id, google.id],
      remediation: flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "Continue using OBO for per-user resources." : "Use OBO or require explicit approval for autonomous action."
    })
  );
}

function runWorkdayScenario(args: {
  scenario: Scenario;
  events: TimelineEvent[];
  findings: SecurityFinding[];
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  gateway: AgentCoreGatewayNode;
  gatewayToken?: TokenArtifact;
  userToken: TokenArtifact;
  user: UserNode;
  policyEngine: PolicyEngineNode;
}): void {
  const workday = first<ExternalMcpServerNode>(args.scenario, "external_mcp_server", "external-workday");
  const listed = filterPotentiallyAllowedTools(args.policyEngine.policies, args.runtime.workloadIdentity.name, workday.tools);
  args.events.push(gatewayToolsListEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, runtime: args.runtime, gateway: args.gateway, tools: listed.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })), authMode: "OAUTH_JWT", token: args.gatewayToken, mutations: new Set() }));
  const decision = evaluatePolicies({
    engineId: args.policyEngine.id,
    mode: args.policyEngine.mode,
    policies: args.policyEngine.policies,
    principal: args.runtime.workloadIdentity.name,
    action: "workday.get_compensation",
    resource: workday.id,
    context: {
      principal: { id: args.runtime.workloadIdentity.name, department: args.user.department },
      context: { user: args.user, scopes: ["wd.workers.read"] },
      arguments: { workerId: "W-1001" }
    }
  });
  args.events.push(makePolicyEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, gateway: args.gateway, policyEngine: args.policyEngine, decision, action: "workday.get_compensation" }));
  args.events.push(gatewayToolCallEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, runtime: args.runtime, gateway: args.gateway, toolName: "workday.get_compensation", policyDecision: decision }));
  args.findings.push(
    finding({
      type: decision.defaultDeny ? "policy_default_deny" : "sensitive_tool_requires_human_approval",
      severity: "high",
      title: "Workday compensation access denied",
      explanation: "Call-time policy denied sensitive compensation access. Tool listing did not guarantee authorization.",
      affectedNodes: [args.gateway.id, workday.id],
      remediation: "Require the correct scope, People department authorization, and a human approval path for sensitive compensation data."
    })
  );
}

function runDirectVsGatewayMcpScenario(args: {
  scenario: Scenario;
  events: TimelineEvent[];
  findings: SecurityFinding[];
  mutationSet: Set<string>;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  identity: AgentCoreIdentityNode;
  authorizationServer: AuthorizationServerNode;
  gateway: AgentCoreGatewayNode;
  gatewayToken?: TokenArtifact;
  userToken: TokenArtifact;
  user: UserNode;
  policyEngine: PolicyEngineNode;
}): void {
  const slack = first<ExternalMcpServerNode>(args.scenario, "external_mcp_server", "external-slack");
  args.events.push(directMcpCallEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, runtime: args.runtime, mcp: slack, toolName: "slack.post_message", includeSessionId: !args.mutationSet.has("remove_mcp_session_id") }));
  args.findings.push(
    finding({
      type: "api_key_static_secret_risk",
      severity: "medium",
      title: "Direct path uses static bearer/API key",
      explanation: "The direct Slack path models a long-lived static credential outside AgentCore Identity mediation.",
      affectedNodes: [args.runtime.id, slack.id],
      remediation: "Prefer Gateway plus Identity credential providers for rotation, audit and policy checks."
    })
  );
  const listed = filterPotentiallyAllowedTools(args.policyEngine.policies, args.runtime.workloadIdentity.name, slack.tools);
  args.events.push(gatewayToolsListEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, runtime: args.runtime, gateway: args.gateway, tools: listed.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })), authMode: "OAUTH_JWT", token: args.gatewayToken, mutations: args.mutationSet }));
  const decision = evaluatePolicies({
    engineId: args.policyEngine.id,
    mode: args.policyEngine.mode,
    policies: args.policyEngine.policies,
    principal: args.runtime.workloadIdentity.name,
    action: "slack.post_message",
    resource: slack.id,
    context: { principal: { id: args.runtime.workloadIdentity.name }, context: { user: args.user, scopes: ["chat:write"] }, arguments: { channel: "expense-updates" } }
  });
  args.events.push(makePolicyEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, gateway: args.gateway, policyEngine: args.policyEngine, decision, action: "slack.post_message" }));
  args.events.push(gatewayToolCallEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, runtime: args.runtime, gateway: args.gateway, toolName: "slack.post_message", policyDecision: decision }));
  args.events.push(
    ...identityOutboundOauthEvents({
      index: args.events.length + 1,
      traceId: args.traceId,
      correlationId: args.correlationId,
      gateway: args.gateway,
      identity: args.identity,
      authorizationServer: args.authorizationServer,
      providerName: "slack-bot",
      flow: "CLIENT_CREDENTIALS",
      scopes: ["chat:write"],
      actor: args.runtime.workloadIdentity.name,
      subject: String(args.userToken.claims?.sub ?? args.user.id)
    })
  );
  args.events.push(targetMcpCallEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, sourceId: args.gateway.id, target: slack, toolName: "slack.post_message" }));
}

function runA2AScenario(args: {
  scenario: Scenario;
  events: TimelineEvent[];
  findings: SecurityFinding[];
  mutationSet: Set<string>;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  gateway: AgentCoreGatewayNode;
  gatewayToken?: TokenArtifact;
  userToken: TokenArtifact;
  user: UserNode;
  policyEngine: PolicyEngineNode;
}): void {
  const target = first<AgentCoreRuntimeAgentNode>(args.scenario, "agentcore_runtime_agent", "agent-policy-review");
  const runtimeGatewayHeader = forwardedHeaderForEdge(args.scenario, "runtime_to_gateway_mcp", args.runtime.id, args.gateway.id);
  const gatewayRuntimeHeader = forwardedHeaderForEdge(args.scenario, "gateway_to_http_runtime_target", args.gateway.id, target.id);
  args.events.push(...directA2AEvents({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, source: args.runtime, target }));
  args.events.push(
    gatewayToolsListEvent({
      index: args.events.length + 1,
      traceId: args.traceId,
      correlationId: args.correlationId,
      runtime: args.runtime,
      gateway: args.gateway,
      tools: [{ name: "runtime.invoke.PolicyReviewAgent", description: "Invoke PolicyReviewAgent as a Gateway HTTP target", inputSchema: { type: "object" } }],
      authMode: "AWS_IAM_SIGV4",
      token: args.gatewayToken,
      forwardedOAuthTokenHeader: runtimeGatewayHeader,
      mutations: args.mutationSet
    })
  );
  args.events.push(
    forwardedOAuthContextEvent({
      index: args.events.length + 1,
      traceId: args.traceId,
      correlationId: args.correlationId,
      sourceNodeId: args.runtime.id,
      gateway: args.gateway,
      token: args.userToken,
      forwardedOAuthTokenHeader: runtimeGatewayHeader,
      missing: args.mutationSet.has("forwarded_oauth_header_missing")
    })
  );
  const decision = evaluatePolicies({
    engineId: args.policyEngine.id,
    mode: args.policyEngine.mode,
    policies: args.policyEngine.policies,
    principal: args.runtime.workloadIdentity.name,
    action: "runtime.invoke.PolicyReviewAgent",
    resource: target.runtimeArn,
    context: { principal: { id: args.runtime.workloadIdentity.name }, context: { user: args.user, scopes: ["agent.invoke"] }, arguments: { review: true } }
  });
  args.events.push(makePolicyEvent({ index: args.events.length + 1, traceId: args.traceId, correlationId: args.correlationId, gateway: args.gateway, policyEngine: args.policyEngine, decision, action: "runtime.invoke.PolicyReviewAgent" }));
  args.events.push(
    gatewayToRuntimeSigV4Event({
      index: args.events.length + 1,
      traceId: args.traceId,
      correlationId: args.correlationId,
      gateway: args.gateway,
      target,
      userToken: args.userToken,
      forwardedOAuthTokenHeader: gatewayRuntimeHeader,
      mutations: args.mutationSet
    })
  );
  args.findings.push(
    finding({
      type: "sigv4_gateway_to_runtime_ok",
      severity: "info",
      title: "Gateway to Runtime uses SigV4",
      explanation: "The Gateway-mediated path signs the target runtime invocation with SigV4 and carries user OAuth context in a custom header.",
      affectedNodes: [args.gateway.id, target.id],
      remediation: "Keep IAM resource scope narrow and validate/redact the forwarded OAuth context header."
    })
  );
}

function finish(scenario: Scenario, events: TimelineEvent[], findings: SecurityFinding[], steps: ScenarioStep[]): SimulationResult {
  const securityFindings = uniqueFindings(findings);
  const { events: filteredEvents, steps: resultSteps } = eventsForSteps(events, scenario, steps);
  return {
    status: statusFromEvents(filteredEvents),
    events: filteredEvents,
    steps: resultSteps,
    securityFindings,
    generatedArtifacts: {
      mermaid: buildMermaid(filteredEvents, scenario),
      curlSnippets: filteredEvents.map(buildCurl).filter((snippet): snippet is string => Boolean(snippet)),
      traceJson: { scenarioId: scenario.id, steps: resultSteps, status: statusFromEvents(filteredEvents), events: filteredEvents, securityFindings }
    }
  };
}
