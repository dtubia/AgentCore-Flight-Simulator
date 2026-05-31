import type { TimelineEvent } from "../../model/events";
import type { AgentCoreRuntimeAgentNode, ClientAppNode } from "../../model/nodes";
import type { TokenArtifact } from "../../model/auth";
import { tokenValidationPassed, validationReason } from "../token/validators";

export function runtimeInvocationEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  client: ClientAppNode;
  runtime: AgentCoreRuntimeAgentNode;
  prompt: string;
  token?: TokenArtifact;
  removeAuthorization: boolean;
}): TimelineEvent {
  const escapedArn = encodeURIComponent(args.runtime.runtimeArn);
  const url = `https://bedrock-agentcore.us-west-2.amazonaws.com/runtimes/${escapedArn}/invocations?qualifier=${args.runtime.qualifier}`;
  const validation = args.token?.validation;
  const passed = !args.removeAuthorization && tokenValidationPassed(validation);
  const isJwtRuntime = args.runtime.inboundAuth.mode !== "AWS_IAM_SIGV4";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": args.runtime.session.runtimeSessionId,
    "X-Amzn-Trace-Id": args.traceId,
    "X-Correlation-Id": args.correlationId
  };
  if (!args.removeAuthorization) headers.Authorization = "Bearer ACCESS_TOKEN_SIMULATED";

  return {
    id: "runtime-invoke",
    index: args.index,
    title: "Invoke AgentCore Runtime",
    sourceNodeId: args.client.id,
    targetNodeId: args.runtime.id,
    protocol: "HTTP",
    method: "POST",
    url,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { headers, body: { prompt: args.prompt } },
    response: passed
      ? { status: 200, headers: { "Content-Type": "application/json" }, body: { status: "accepted", runtimeSessionId: args.runtime.session.runtimeSessionId } }
      : {
          status: isJwtRuntime ? 401 : 403,
          headers: isJwtRuntime
            ? { "WWW-Authenticate": `Bearer resource_metadata="${url.replace("/invocations", "/invocations/.well-known/oauth-protected-resource")}"` }
            : {},
          body: { code: isJwtRuntime ? "UNAUTHORIZED" : "ACCESS_DENIED", message: validationReason(validation) }
        },
    token: args.token,
    verdict: {
      outcome: passed ? "allow" : "deny",
      reason: passed ? "Inbound JWT validation passed." : validationReason(validation),
      securityNotes: passed
        ? ["Runtime checks signature, issuer, audience, client, scope, expiry and tenant."]
        : [isJwtRuntime ? "OAuth bearer failures include protected-resource metadata." : "SigV4-configured runtimes return 403 without WWW-Authenticate."]
    }
  };
}
