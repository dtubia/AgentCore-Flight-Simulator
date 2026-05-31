import type { TimelineEvent, PolicyDecision } from "../../model/events";
import type { AgentCoreGatewayNode, AgentCoreRuntimeAgentNode } from "../../model/nodes";
import type { TokenArtifact } from "../../model/auth";
import { createSigV4Headers, sigv4Passed, validateSigV4 } from "./sigv4";

export function gatewayToolsListEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  gateway: AgentCoreGatewayNode;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  authMode: "OAUTH_JWT" | "AWS_IAM_SIGV4";
  token?: TokenArtifact;
  forwardedOAuthTokenHeader?: string;
  mutations: Set<string>;
}): TimelineEvent {
  const body = { jsonrpc: "2.0", id: "list-tools-request", method: "tools/list" };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "X-Amzn-Trace-Id": args.traceId,
    "X-Correlation-Id": args.correlationId
  };
  let sigv4 = undefined;
  if (args.authMode === "AWS_IAM_SIGV4") {
    sigv4 = validateSigV4({
      method: "POST",
      host: new URL(args.gateway.gatewayUrl).host,
      path: "/mcp",
      body,
      auth: args.gateway.inboundAuth,
      action: "bedrock-agentcore:InvokeGateway",
      resource: args.gateway.gatewayArn,
      mutations: args.mutations
    });
    Object.assign(headers, createSigV4Headers({
      method: "POST",
      host: new URL(args.gateway.gatewayUrl).host,
      path: "/mcp",
      body,
      auth: args.gateway.inboundAuth,
      action: "bedrock-agentcore:InvokeGateway",
      resource: args.gateway.gatewayArn,
      mutations: args.mutations
    }));
    const customHeader = args.forwardedOAuthTokenHeader ?? args.gateway.inboundAuth.forwardedOAuthToken?.headerName ?? "X-AgentCore-Inbound-OAuth-Token";
    if (!args.mutations.has("forwarded_oauth_header_missing")) headers[customHeader] = "ACCESS_TOKEN_SIMULATED";
  } else {
    headers.Authorization = "Bearer GATEWAY_ACCESS_TOKEN_SIMULATED";
  }

  const allowed = args.authMode === "OAUTH_JWT" || sigv4Passed(sigv4);
  return {
    id: "gateway-tools-list",
    index: args.index,
    title: args.authMode === "AWS_IAM_SIGV4" ? "Gateway tools/list with SigV4" : "Gateway tools/list",
    sourceNodeId: args.runtime.id,
    targetNodeId: args.gateway.id,
    protocol: "MCP",
    method: "POST",
    url: args.gateway.gatewayUrl,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { headers, body },
    response: allowed
      ? { status: 200, body: { jsonrpc: "2.0", id: "list-tools-request", result: { tools: args.tools } } }
      : { status: 403, body: { code: "ACCESS_DENIED", message: sigv4?.errors.join(" ") } },
    token: args.token,
    sigv4,
    verdict: {
      outcome: allowed ? "allow" : "deny",
      reason: allowed ? "Gateway inbound authentication succeeded." : "Gateway SigV4 authentication failed.",
      securityNotes:
        args.authMode === "AWS_IAM_SIGV4"
          ? [
              "Authorization is SigV4, not a bearer token.",
              "The OAuth user token is carried in an explicitly configured custom header for user-context validation."
            ]
          : ["Gateway validates bearer token scopes before listing tools."]
    }
  };
}

export function forwardedOAuthContextEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  sourceNodeId: string;
  gateway: AgentCoreGatewayNode;
  token?: TokenArtifact;
  forwardedOAuthTokenHeader?: string;
  missing: boolean;
}): TimelineEvent {
  const header = args.forwardedOAuthTokenHeader ?? args.gateway.inboundAuth.forwardedOAuthToken?.headerName ?? "X-AgentCore-Inbound-OAuth-Token";
  return {
    id: "gateway-forwarded-oauth-context",
    index: args.index,
    title: "Forwarded OAuth context header",
    sourceNodeId: args.sourceNodeId,
    targetNodeId: args.gateway.id,
    protocol: "HTTP",
    method: "POST",
    url: args.gateway.gatewayUrl,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { headers: args.missing ? {} : { [header]: "ACCESS_TOKEN_SIMULATED" }, body: { headerName: header } },
    response: args.missing
      ? { status: 400, body: { code: "MISSING_FORWARDED_OAUTH_CONTEXT", message: `${header} is required for per-user downstream authorization.` } }
      : { status: 200, body: { userContext: args.token?.claims, acceptedAs: "forwarded-user-context" } },
    token: args.token ? { ...args.token, kind: "forwarded-user-context", label: "FORWARDED_ACCESS_TOKEN_SIMULATED" } : undefined,
    verdict: {
      outcome: args.missing ? "deny" : "info",
      reason: args.missing ? "Gateway cannot bind the SigV4 request to a user OAuth context." : "Gateway validated the custom OAuth context header.",
      securityNotes: [
        "This header is not the primary authentication mechanism; SigV4 remains primary.",
        "The header must be explicitly allowed, validated, redacted from logs, and never treated as a secret API key."
      ]
    }
  };
}

export function gatewayToolCallEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  gateway: AgentCoreGatewayNode;
  toolName: string;
  policyDecision?: PolicyDecision;
}): TimelineEvent {
  const denied = args.policyDecision?.effect === "deny" && args.policyDecision.mode === "ENFORCE";
  return {
    id: `gateway-tool-call-${args.toolName}`,
    index: args.index,
    title: `Gateway tools/call ${args.toolName}`,
    sourceNodeId: args.runtime.id,
    targetNodeId: args.gateway.id,
    protocol: "MCP",
    method: "POST",
    url: args.gateway.gatewayUrl,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: {
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: "Bearer GATEWAY_ACCESS_TOKEN_SIMULATED" },
      body: {
        jsonrpc: "2.0",
        id: "tool-call-1",
        method: "tools/call",
        params: { name: args.toolName, arguments: { query: "receipts after:2026-04-01 before:2026-05-01", mimeType: "application/pdf", workerId: "W-1001" }, _meta: { progressToken: "progress-1" } }
      }
    },
    response: denied
      ? {
          status: 200,
          body: {
            jsonrpc: "2.0",
            id: "tool-call-1",
            result: {
              content: [{ type: "text", text: `AuthorizeActionException - Tool Execution Denied: Tool call not allowed due to policy enforcement [${args.policyDecision?.explanation}]` }],
              isError: true
            }
          }
        }
      : {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
          body:
            'event: message\\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"progress-1","progress":1,"total":3,"message":"Checking policy..."}}\\n\\nevent: message\\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"progress-1","progress":2,"total":3,"message":"Fetching delegated OAuth token..."}}\\n\\nevent: message\\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"progress-1","progress":3,"total":3,"message":"Calling MCP target..."}}\\n\\nevent: message\\ndata: {"jsonrpc":"2.0","id":"tool-call-1","result":{"content":[{"type":"text","text":"Found 4 matching receipt PDFs."}],"isError":false}}'
        },
    policyDecision: args.policyDecision,
    verdict: {
      outcome: denied ? "deny" : "allow",
      reason: denied ? "Policy denied the call at MCP tool level." : "Gateway allowed the tool call and streamed progress notifications.",
      securityNotes: denied ? ["MCP tool-level policy deny is returned as JSON-RPC result with isError=true."] : ["Tool listing did not guarantee call-time authorization; policy was still checked."]
    }
  };
}
