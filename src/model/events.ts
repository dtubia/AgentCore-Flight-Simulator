import type { SigV4ValidationResult, TokenArtifact } from "./auth";

export interface PolicyDecision {
  engineId: string;
  mode: "LOG_ONLY" | "ENFORCE";
  effect: "allow" | "deny";
  matchedPolicies: string[];
  defaultDeny: boolean;
  explanation: string;
}

export interface TimelineEvent {
  id: string;
  index: number;
  title: string;
  sourceNodeId: string;
  targetNodeId: string;
  protocol: "OAuth2" | "OIDC" | "HTTP" | "MCP" | "A2A" | "AgentCoreIdentity" | "Policy" | "SigV4";
  method?: string;
  url?: string;
  request: {
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: {
    status?: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
  token?: TokenArtifact;
  sigv4?: SigV4ValidationResult;
  policyDecision?: PolicyDecision;
  verdict: {
    outcome: "allow" | "deny" | "warn" | "info";
    reason: string;
    securityNotes: string[];
  };
  traceId: string;
  correlationId: string;
}
