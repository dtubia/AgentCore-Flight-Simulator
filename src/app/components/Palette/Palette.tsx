import { Play, Upload, RotateCcw } from "lucide-react";
import { scenarios } from "../../../scenarios";
import { useAppStore } from "../../store";
import type { NodeType, ScenarioNode } from "../../../model/nodes";

const palette: { type: NodeType; label: string }[] = [
  { type: "user", label: "User" },
  { type: "client_app", label: "Client App" },
  { type: "external_genai_agent", label: "External Agent" },
  { type: "authorization_server", label: "IdP" },
  { type: "agentcore_runtime_agent", label: "Runtime" },
  { type: "agentcore_gateway", label: "Gateway" },
  { type: "agentcore_identity", label: "Identity" },
  { type: "policy_engine", label: "Policy" },
  { type: "agentcore_mcp_server", label: "AgentCore MCP" },
  { type: "external_mcp_server", label: "External MCP" },
  { type: "external_api", label: "External API" }
];

export function skeletonNode(type: NodeType, x = 120, y = 120): ScenarioNode {
  const id = `${type}-${Math.random().toString(16).slice(2, 8)}`;
  const base = { id, type, displayName: type.replaceAll("_", " "), position: { x, y } };
  if (type === "user") return { ...base, tenant: "bbva-demo", groups: ["employees"], department: "People", riskLevel: "standard" } as ScenarioNode;
  if (type === "client_app") return { ...base, clientId: "client-simulated", redirectUri: "https://app.example.local/callback", pkce: true, allowedScopes: ["openid", "profile"] } as ScenarioNode;
  if (type === "external_genai_agent") {
    return {
      ...base,
      displayName: "External GenAI Agent",
      name: "ExternalGenAiAgent",
      framework: "LangGraph",
      endpoint: "https://external-agent.example.local",
      supportedProtocols: ["HTTP", "MCP", "A2A"],
      outboundAuthModes: ["OAUTH_JWT", "AWS_IAM_SIGV4"],
      oauthClientId: "external-agent-client",
      awsPrincipalArn: "arn:aws:iam::123456789012:role/ExternalAgentCallerRole"
    } as ScenarioNode;
  }
  if (type === "authorization_server") {
    const issuer = "https://keycloak.example.local/realms/agentcore-lab";
    return {
      ...base,
      displayName: "Keycloak AS",
      issuer,
      jwksUri: `${issuer}/protocol/openid-connect/certs`,
      authorizationEndpoint: `${issuer}/protocol/openid-connect/auth`,
      tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
      supportedGrantTypes: ["authorization_code", "client_credentials", "urn:ietf:params:oauth:grant-type:token-exchange"],
      tokenLifetimeSeconds: 3600
    } as ScenarioNode;
  }
  if (type === "agentcore_gateway") return { ...base, gatewayArn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:gateway/custom-abcdefghij", gatewayUrl: "https://custom.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp", protocol: "MCP", inboundAuth: { mode: "AWS_IAM_SIGV4" }, policyMode: "ENFORCE", semanticSearchEnabled: true } as ScenarioNode;
  if (type === "agentcore_identity") return { ...base, tokenVault: { arn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:token-vault/default" }, credentialProviders: [] } as ScenarioNode;
  if (type === "policy_engine") return { ...base, mode: "ENFORCE", policies: [] } as ScenarioNode;
  if (type === "agentcore_mcp_server") return { ...base, name: "CustomMcpServer", runtimeArn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/custom-mcp", protocol: "MCP", endpoint: "/mcp", port: 8000, statelessHttp: true, requiresMcpSessionId: true, tools: [] } as ScenarioNode;
  if (type === "external_mcp_server") return { ...base, name: "GitHub MCP Adapter", vendor: "GitHub", endpoint: "https://mcp.github-adapter.example.local/mcp", auth: { type: "OAuth2", mode: "authorization_code", credentialProviderName: "github-user" }, tools: [{ name: "github.list_issues", description: "List GitHub issues", requiredScopes: ["repo"], inputSchema: { type: "object" } }, { name: "github.create_issue", description: "Create a GitHub issue", requiredScopes: ["repo"], inputSchema: { type: "object" } }, { name: "github.read_repo_file", description: "Read a repository file", requiredScopes: ["repo"], inputSchema: { type: "object" } }, { name: "github.dispatch_workflow", description: "Dispatch a workflow", requiredScopes: ["workflow"], inputSchema: { type: "object" } }], errors: ["401 bad_credentials", "403 resource_not_accessible_by_integration", "404 not_found", "422 validation_failed"] } as ScenarioNode;
  if (type === "external_api") return { ...base, displayName: "External REST API", name: "ExternalRestApi", endpoint: "https://api.example.local/v1/actions", protocol: "HTTP", auth: { modes: ["OAUTH_JWT"], requiredScopes: ["api.invoke"] } } as ScenarioNode;
  return { ...base, name: "RuntimeAgent", runtimeArn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/custom-agent", qualifier: "DEFAULT", protocol: "HTTP", inboundAuth: { mode: "OAUTH_JWT" }, workloadIdentity: { name: "custom-agent", arn: "arn:aws:bedrock-agentcore:us-west-2:123456789012:workload-identity-directory/default/workload-identity/custom-agent" }, session: { runtimeSessionId: "session-custom", state: "idle" } } as ScenarioNode;
}

export function Palette() {
  const { scenario, loadScenario, run, userPrompt, setUserPrompt, toggleMutation, addNode } = useAppStore();
  const addPaletteNode = (type: NodeType) => {
    const index = scenario.nodes.length;
    const x = 60 + (index % 4) * 220;
    const y = 80 + Math.floor(index / 4) * 90;
    return addNode(skeletonNode(type, x, y));
  };
  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 scrollbar-thin">
      <div>
        <label className="field-label">Scenario Presets</label>
        <select className="mt-1 w-full border border-console-line bg-console-rail px-2 py-2 text-xs" value={scenario.id} onChange={(event) => void loadScenario(event.target.value)}>
          {scenarios.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="field-label">User Prompt</label>
        <textarea className="mt-1 h-20 w-full resize-none border border-console-line bg-console-rail p-2 font-mono text-xs" value={userPrompt} onChange={(event) => setUserPrompt(event.target.value)} />
      </div>
      <button className="flex items-center justify-center gap-2 border border-console-cyan bg-console-cyan/10 px-3 py-2 text-xs font-semibold text-console-cyan" onClick={() => void run()}>
        <Play size={14} /> Simulate
      </button>
      <div>
        <div className="field-label mb-2">Component Palette</div>
        <div className="grid grid-cols-2 gap-2">
          {palette.map((item) => (
            <button
              key={item.type}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("application/agentcore-node", item.type)}
              onClick={() => void addPaletteNode(item.type)}
              className="border border-console-line bg-console-panel2 px-2 py-2 text-left text-[11px] hover:border-console-cyan"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="field-label mb-2 flex items-center gap-1">
          <RotateCcw size={12} /> Mutate
        </div>
        <div className="space-y-1">
          {scenario.mutations.map((mutation) => (
            <label key={mutation.id} className="flex cursor-pointer items-start gap-2 border border-console-line bg-console-rail p-2 text-[11px]">
              <input type="checkbox" className="mt-0.5 accent-console-cyan" checked={Boolean(mutation.enabled)} onChange={() => void toggleMutation(mutation.id)} />
              <span>
                <span className="block text-console-text">{mutation.label}</span>
                <span className="block text-console-muted">{mutation.expectedFinding}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <button className="flex items-center justify-center gap-2 border border-console-line bg-console-panel2 px-3 py-2 text-xs" onClick={() => navigator.clipboard.writeText(JSON.stringify(scenario, null, 2))}>
        <Upload size={14} /> Copy Scenario JSON
      </button>
    </div>
  );
}
