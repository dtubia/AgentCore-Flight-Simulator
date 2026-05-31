import type { TimelineEvent } from "../../model/events";
import type { AgentCoreMcpServerNode, AgentCoreRuntimeAgentNode, ExternalMcpServerNode } from "../../model/nodes";

export function directMcpCallEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  mcp: AgentCoreMcpServerNode | ExternalMcpServerNode;
  toolName: string;
  includeSessionId: boolean;
}): TimelineEvent {
  const isAgentCoreRuntime = args.mcp.type === "agentcore_mcp_server";
  const host = isAgentCoreRuntime
    ? `${args.mcp.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.runtime.bedrock-agentcore.us-west-2.amazonaws.com`
    : new URL((args.mcp as ExternalMcpServerNode).endpoint).host;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: "Bearer ACCESS_TOKEN_SIMULATED",
    "X-Amzn-Trace-Id": args.traceId,
    "X-Correlation-Id": args.correlationId
  };
  if (args.includeSessionId) headers["Mcp-Session-Id"] = "mcp-session-000000000001";
  return {
    id: "direct-mcp-call",
    index: args.index,
    title: "Direct MCP tools/call",
    sourceNodeId: args.runtime.id,
    targetNodeId: args.mcp.id,
    protocol: "MCP",
    method: "POST",
    url: isAgentCoreRuntime
      ? `https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/${encodeURIComponent((args.mcp as AgentCoreMcpServerNode).runtimeArn)}/invocations?qualifier=DEFAULT`
      : (args.mcp as ExternalMcpServerNode).endpoint,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: {
      headers,
      body: {
        jsonrpc: "2.0",
        id: "direct-mcp-call-1",
        method: "tools/call",
        params: { name: args.toolName, arguments: { userId: "user-alice", fromDate: "2026-04-01", toDate: "2026-05-01" } }
      }
    },
    response: {
      status: 200,
      headers: args.includeSessionId ? { "Content-Type": "application/json" } : { "Content-Type": "application/json", "Mcp-Session-Id": "mcp-session-000000000001" },
      body: { jsonrpc: "2.0", id: "direct-mcp-call-1", result: { content: [{ type: "text", text: "Direct MCP target returned simulated results." }], isError: false } }
    },
    verdict: {
      outcome: args.includeSessionId ? "warn" : "warn",
      reason: "Direct MCP call bypasses Gateway governance.",
      securityNotes: [
        "Gateway policy, semantic catalog, centralized audit and target credential mediation are bypassed.",
        args.includeSessionId
          ? "Mcp-Session-Id was reused for stateful MCP continuity."
          : "Missing or changed Mcp-Session-Id may route to a new microVM and lose state or increase cold-start latency."
      ]
    }
  };
}

export function targetMcpCallEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  sourceId: string;
  target: ExternalMcpServerNode | AgentCoreMcpServerNode;
  toolName: string;
  isError?: boolean;
}): TimelineEvent {
  return {
    id: `target-mcp-${args.toolName}`,
    index: args.index,
    title: "Gateway calls MCP target",
    sourceNodeId: args.sourceId,
    targetNodeId: args.target.id,
    protocol: "MCP",
    method: "POST",
    url: args.target.type === "external_mcp_server" ? args.target.endpoint : `https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/${encodeURIComponent(args.target.runtimeArn)}/invocations?qualifier=DEFAULT`,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: {
      headers: { "Content-Type": "application/json", Authorization: "Bearer DOWNSTREAM_TARGET_TOKEN_SIMULATED" },
      body: { jsonrpc: "2.0", id: "target-call-1", method: "tools/call", params: { name: args.toolName, arguments: { query: "receipts after:2026-04-01 before:2026-05-01" } } }
    },
    response: {
      status: args.isError ? 403 : 200,
      body: args.isError
        ? { error: "insufficient_scope" }
        : { jsonrpc: "2.0", id: "target-call-1", result: { content: [{ type: "text", text: "Found 4 matching receipt PDFs." }], isError: false } }
    },
    verdict: {
      outcome: args.isError ? "deny" : "allow",
      reason: args.isError ? "Target rejected the delegated token." : "Target accepted the delegated credential.",
      securityNotes: [args.target.type === "external_mcp_server" ? `${args.target.name} is simulated and no external network call is made.` : "AgentCore-hosted MCP server is invoked through the Runtime endpoint."]
    }
  };
}
