import type { TimelineEvent } from "../../model/events";
import type { AgentCoreRuntimeAgentNode } from "../../model/nodes";

export function directA2AEvents(args: {
  index: number;
  traceId: string;
  correlationId: string;
  source: AgentCoreRuntimeAgentNode;
  target: AgentCoreRuntimeAgentNode;
}): TimelineEvent[] {
  const host = `${args.target.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.runtime.bedrock-agentcore.us-west-2.amazonaws.com`;
  return [
    {
      id: "a2a-agent-card",
      index: args.index,
      title: "A2A agent card discovery",
      sourceNodeId: args.source.id,
      targetNodeId: args.target.id,
      protocol: "A2A",
      method: "GET",
      url: `https://${host}/.well-known/agent.json`,
      traceId: args.traceId,
      correlationId: args.correlationId,
      request: { headers: { Authorization: "Bearer ACCESS_TOKEN_SIMULATED", "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": args.target.session.runtimeSessionId } },
      response: {
        status: 200,
        body: {
          name: args.target.name,
          description: "Reviews policy and compliance implications of planned tool calls",
          version: "1.0.0",
          protocolVersion: "0.3.0",
          preferredTransport: "JSONRPC",
          capabilities: { streaming: true },
          skills: [{ id: "policy-risk-review", name: "Policy risk review", tags: ["security", "governance"] }]
        }
      },
      verdict: { outcome: "warn", reason: "Direct A2A discovery bypasses Gateway policy.", securityNotes: ["Direct A2A can be acceptable for low-latency trusted agent meshes but has less central governance."] }
    },
    {
      id: "a2a-message-send",
      index: args.index + 1,
      title: "A2A message/send",
      sourceNodeId: args.source.id,
      targetNodeId: args.target.id,
      protocol: "A2A",
      method: "POST",
      url: `https://${host}/`,
      traceId: args.traceId,
      correlationId: args.correlationId,
      request: {
        headers: { "Content-Type": "application/json", Authorization: "Bearer ACCESS_TOKEN_SIMULATED", "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": args.target.session.runtimeSessionId },
        body: {
          jsonrpc: "2.0",
          id: "a2a-req-001",
          method: "message/send",
          params: { message: { role: "user", parts: [{ kind: "text", text: "Review whether this Workday compensation request should be allowed." }], messageId: "msg-001" } }
        }
      },
      response: { status: 200, body: { jsonrpc: "2.0", id: "a2a-req-001", result: { message: { role: "agent", parts: [{ kind: "text", text: "Review completed. Route sensitive action through Gateway policy." }] } } } },
      verdict: { outcome: "warn", reason: "Direct A2A succeeds with reduced central governance.", securityNotes: ["No Gateway policy event is produced for the direct call path."] }
    }
  ];
}
