import { describe, expect, it } from "vitest";
import { scenarios } from "../scenarios";
import type { Scenario } from "../model/schema";
import { simulateScenario } from "../engine/simulate";
import { isLegalEdge, legalEdgeKinds, type EdgeKind } from "../model/edges";
import type { ExternalApiNode, ExternalGenAiAgentNode, AgentCoreMcpServerNode } from "../model/nodes";
import { evaluateCondition } from "../engine/policy/localPolicyEngine";

function scenario(id: string): Scenario {
  return JSON.parse(JSON.stringify(scenarios.find((item) => item.id === id))) as Scenario;
}

function enableMutation(base: Scenario, id: string): Scenario {
  return {
    ...base,
    mutations: base.mutations.map((mutation) => (mutation.id === id ? { ...mutation, enabled: true } : { ...mutation, enabled: false }))
  };
}

describe("AgentCore-Flight-Simulator simulation", () => {
  it("uses Keycloak OIDC endpoints instead of Cognito endpoints", async () => {
    const s = scenario("01-google-drive-obo");
    const serialized = JSON.stringify(s);
    expect(serialized).toContain("https://keycloak.example.local/realms/agentcore-lab");
    expect(serialized).not.toMatch(/cognito/i);
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    expect(result.events.find((event) => event.id === "oauth-authorize")?.url).toContain("/protocol/openid-connect/auth?");
    expect(result.events.find((event) => event.id === "oauth-token-request")?.url).toBe("https://keycloak.example.local/realms/agentcore-lab/protocol/openid-connect/token");
  });

  it("rejects JWT audience replay", async () => {
    const s = scenario("02-wrong-audience");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    expect(result.status).toBe("failed");
    expect(result.securityFindings.some((finding) => finding.type === "wrong_audience")).toBe(true);
    expect(result.events.find((event) => event.id === "runtime-invoke")?.response.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const s = enableMutation(scenario("01-google-drive-obo"), "expire_token");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    expect(result.status).toBe("failed");
    expect(result.securityFindings.some((finding) => finding.type === "expired_token")).toBe(true);
  });

  it("rejects missing runtime scopes", async () => {
    const s = enableMutation(scenario("01-google-drive-obo"), "missing_scope");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    expect(result.securityFindings.some((finding) => finding.type === "missing_scope")).toBe(true);
  });

  it("denies Workday compensation through Gateway policy", async () => {
    const s = scenario("03-workday-policy-deny");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const policy = result.events.find((event) => event.id === "policy-workday.get_compensation");
    expect(policy?.policyDecision?.effect).toBe("deny");
    expect(result.securityFindings.some((finding) => finding.title.includes("Workday compensation"))).toBe(true);
  });

  it("filters tools/list by potentially allowed policy", async () => {
    const s = scenario("03-workday-policy-deny");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const list = result.events.find((event) => event.id === "gateway-tools-list")?.response.body as {
      result?: { tools?: { name: string }[] };
    };
    expect(list.result?.tools?.map((tool) => tool.name)).toEqual(["workday.get_worker"]);
  });

  it("reports direct MCP bypass warning", async () => {
    const s = scenario("04-direct-vs-gateway-mcp");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    expect(result.securityFindings.some((finding) => finding.type === "direct_tool_call_bypasses_gateway_policy")).toBe(true);
  });

  it("reports missing Mcp-Session-Id warning", async () => {
    const s = enableMutation(scenario("04-direct-vs-gateway-mcp"), "remove_mcp_session_id");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    expect(result.events.find((event) => event.id === "direct-mcp-call")?.request.headers?.["Mcp-Session-Id"]).toBeUndefined();
    expect(result.securityFindings.some((finding) => finding.type === "mcp_session_id_missing")).toBe(true);
  });

  it("preserves user and agent identity with OBO", async () => {
    const s = scenario("01-google-drive-obo");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const pep = result.events.find((event) => event.id === "identity-pep-google-drive-obo");
    expect(pep?.policyDecision?.effect).toBe("allow");
    expect(pep?.policyDecision?.matchedPolicies).toContain("workload-identity:allowed");
    expect(result.events.find((event) => event.id === "identity-as-token-google-drive-obo")?.url).toBe("https://keycloak.example.local/realms/agentcore-lab/protocol/openid-connect/token");
    const obo = result.events.find((event) => event.id === "identity-outbound-google-drive-obo");
    expect(obo?.token?.kind).toBe("obo");
    expect(obo?.token?.boundActor).toBe("travel-expense-agent");
    expect(obo?.token?.boundSubject).toBe("user-alice");
  });

  it("allows Gateway to Runtime SigV4 invocation", async () => {
    const s = scenario("05-agent-to-agent-direct-vs-gateway");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const sigv4 = result.events.find((event) => event.id === "gateway-runtime-sigv4");
    expect(sigv4?.response.status).toBe(200);
    expect(sigv4?.sigv4?.signatureValid).toBe(true);
    expect(sigv4?.request.headers?.["X-AgentCore-Forwarded-OAuth-Token"]).toBe("ACCESS_TOKEN_SIMULATED");
  });

  it("uses edge-selected custom OAuth context header on SigV4 Gateway ingress", async () => {
    const s = scenario("05-agent-to-agent-direct-vs-gateway");
    s.edges = s.edges.map((edge) =>
      edge.id === "e-runtime-gateway"
        ? { ...edge, forwardedOAuthTokenHeader: "X-Forwarded-Authorization" }
        : edge
    );
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const toolsList = result.events.find((event) => event.id === "gateway-tools-list");
    expect(toolsList?.request.headers?.["X-Forwarded-Authorization"]).toBe("ACCESS_TOKEN_SIMULATED");
    expect(toolsList?.request.headers?.["X-AgentCore-Inbound-OAuth-Token"]).toBeUndefined();
  });

  it("fails SigV4 for wrong region or service", async () => {
    const s = enableMutation(scenario("05-agent-to-agent-direct-vs-gateway"), "sigv4_wrong_region_service");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const sigv4 = result.events.find((event) => event.id === "gateway-runtime-sigv4");
    expect(sigv4?.response.status).toBe(403);
    expect(sigv4?.sigv4?.regionValid).toBe(false);
    expect(sigv4?.sigv4?.serviceValid).toBe(false);
  });

  it("fails SigV4 when IAM principal lacks InvokeAgentRuntime", async () => {
    const s = enableMutation(scenario("05-agent-to-agent-direct-vs-gateway"), "sigv4_missing_invoke_permission");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const sigv4 = result.events.find((event) => event.id === "gateway-runtime-sigv4");
    expect(sigv4?.response.status).toBe(403);
    expect(sigv4?.sigv4?.actionAllowed).toBe(false);
  });

  it("returns 403 without WWW-Authenticate for SigV4 failure", async () => {
    const s = enableMutation(scenario("05-agent-to-agent-direct-vs-gateway"), "sigv4_missing_authorization");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const sigv4 = result.events.find((event) => event.id === "gateway-runtime-sigv4");
    expect(sigv4?.response.status).toBe(403);
    expect(sigv4?.response.headers?.["WWW-Authenticate"]).toBeUndefined();
  });

  it("exposes legal connection options for external clients and external agents", () => {
    const expected: Array<[string, string, EdgeKind]> = [
      ["client_app", "agentcore_gateway", "client_to_gateway_mcp"],
      ["client_app", "external_api", "client_to_external_api"],
      ["external_genai_agent", "authorization_server", "external_agent_to_authorization_server"],
      ["external_genai_agent", "agentcore_gateway", "external_agent_to_gateway_mcp"],
      ["external_genai_agent", "agentcore_mcp_server", "external_agent_to_mcp_direct"],
      ["external_genai_agent", "external_mcp_server", "external_agent_to_mcp_direct"],
      ["external_genai_agent", "agentcore_runtime_agent", "external_agent_to_runtime_http"],
      ["external_genai_agent", "agentcore_runtime_agent", "external_agent_to_runtime_a2a"],
      ["external_genai_agent", "external_api", "external_agent_to_external_api"],
      ["agentcore_runtime_agent", "external_api", "runtime_to_external_api"],
      ["agentcore_gateway", "external_api", "gateway_to_external_api_target"]
    ];
    for (const [source, target, kind] of expected) {
      expect(isLegalEdge(kind, source, target), `${kind} should be legal`).toBe(true);
      expect(legalEdgeKinds(source, target)).toContain(kind);
    }
    expect(legalEdgeKinds("client_app", "external_mcp_server")).not.toContain("external_agent_to_mcp_direct");
  });

  it("simulates dynamic connectivity edges for external agents, clients, Gateway targets and APIs", async () => {
    const s = scenario("01-google-drive-obo");
    const externalAgent: ExternalGenAiAgentNode = {
      id: "external-agent-1",
      type: "external_genai_agent",
      displayName: "External GenAI Agent",
      name: "ExternalAgent",
      framework: "LangGraph",
      endpoint: "https://external-agent.example.local",
      supportedProtocols: ["HTTP", "MCP", "A2A"],
      outboundAuthModes: ["OAUTH_JWT", "AWS_IAM_SIGV4"],
      oauthClientId: "external-agent-client",
      awsPrincipalArn: "arn:aws:iam::123456789012:role/ExternalAgentCallerRole"
    };
    const externalApi: ExternalApiNode = {
      id: "external-api-1",
      type: "external_api",
      displayName: "External REST API",
      name: "ExternalRestApi",
      endpoint: "https://api.example.local/v1/actions",
      protocol: "HTTP",
      auth: { modes: ["OAUTH_JWT", "AWS_IAM_SIGV4"], requiredScopes: ["api.invoke"] }
    };
    const agentCoreMcp: AgentCoreMcpServerNode = {
      id: "mcp-agentcore-1",
      type: "agentcore_mcp_server",
      displayName: "AgentCore MCP Server",
      name: "AgentCoreMcpServer",
      runtimeArn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/agentcore-mcp-abcd123456",
      protocol: "MCP",
      endpoint: "/mcp",
      port: 8000,
      statelessHttp: true,
      requiresMcpSessionId: true,
      tools: []
    };
    s.nodes.push(externalAgent, externalApi, agentCoreMcp);
    s.edges.push(
      { id: "dyn-client-gateway", source: "client-portal", target: "gateway-enterprise-tools", kind: "client_to_gateway_mcp", authMode: "OAUTH_JWT" },
      { id: "dyn-client-api", source: "client-portal", target: "external-api-1", kind: "client_to_external_api", authMode: "OAUTH_JWT" },
      { id: "dyn-agent-idp", source: "external-agent-1", target: "idp-keycloak", kind: "external_agent_to_authorization_server", authMode: "OAUTH_JWT" },
      { id: "dyn-agent-gateway", source: "external-agent-1", target: "gateway-enterprise-tools", kind: "external_agent_to_gateway_mcp", authMode: "AWS_IAM_SIGV4", forwardedOAuthTokenHeader: "X-AgentCore-Inbound-OAuth-Token" },
      { id: "dyn-agent-mcp-agentcore", source: "external-agent-1", target: "mcp-agentcore-1", kind: "external_agent_to_mcp_direct", authMode: "OAUTH_JWT" },
      { id: "dyn-agent-mcp-external", source: "external-agent-1", target: "external-google-drive", kind: "external_agent_to_mcp_direct", authMode: "OAUTH_JWT" },
      { id: "dyn-agent-runtime-http", source: "external-agent-1", target: "agent-travel", kind: "external_agent_to_runtime_http", authMode: "AWS_IAM_SIGV4" },
      { id: "dyn-agent-api", source: "external-agent-1", target: "external-api-1", kind: "external_agent_to_external_api", authMode: "OAUTH_JWT" },
      { id: "dyn-runtime-api", source: "agent-travel", target: "external-api-1", kind: "runtime_to_external_api", authMode: "OAUTH_JWT" },
      { id: "dyn-gateway-api", source: "gateway-enterprise-tools", target: "external-api-1", kind: "gateway_to_external_api_target", authMode: "AWS_IAM_SIGV4" }
    );
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    for (const edge of s.edges.filter((edge) => edge.id.startsWith("dyn-"))) {
      expect(result.events.find((event) => event.id === `topology-connectivity-${edge.id}`), `${edge.id} should create a dynamic event`).toBeTruthy();
    }
    expect(result.events.find((event) => event.id === "topology-connectivity-dyn-agent-gateway")?.request.headers?.["X-AgentCore-Inbound-OAuth-Token"]).toBe("ACCESS_TOKEN_SIMULATED");
    expect(result.events.find((event) => event.id === "topology-connectivity-dyn-gateway-api")?.sigv4?.signatureValid).toBe(true);
  });

  it("simulates denied token exchange when requested scopes exceed provider grant", async () => {
    const s = enableMutation(scenario("01-google-drive-obo"), "token_exchange_extra_scope");
    const result = await simulateScenario({ scenario: s, userPrompt: s.initialUserPrompt, mutations: s.mutations });
    const pep = result.events.find((event) => event.id === "identity-pep-google-drive-obo");
    expect(pep?.policyDecision?.effect).toBe("deny");
    expect(pep?.policyDecision?.matchedPolicies).toContain("scopes:denied");
    expect(result.securityFindings.some((finding) => finding.type === "token_exchange_scope_escalation_denied")).toBe(true);
  });

  it("evaluates AgentCore-style principal tags, scope patterns, actor and subject policy conditions", () => {
    const ctx = {
      principal: {
        id: "AgentCore::OAuthUser::user-alice",
        tags: {
          sub: "user-alice",
          scope: "agent.invoke mcp.tools.call",
          act: "travel-expense-agent"
        }
      },
      context: {
        input: { amount: 450 },
        subject: { id: "user-alice", department: "People" },
        actor: { id: "travel-expense-agent" },
        token: { act: { sub: "travel-expense-agent" }, sub: "user-alice" }
      },
      arguments: { workerId: "W-1001" }
    };
    expect(evaluateCondition("principal.hasTag('scope') && principal.getTag('scope') like '*mcp.tools.call*'", ctx)).toBe(true);
    expect(evaluateCondition("context.token.act.sub == 'travel-expense-agent' && context.token.sub == 'user-alice'", ctx)).toBe(true);
    expect(evaluateCondition("context.input.amount < 500", ctx)).toBe(true);
  });
});
