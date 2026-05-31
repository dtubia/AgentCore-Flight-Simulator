import { z } from "zod";
import type { ScenarioEdge } from "./edges";
import type { SecurityFinding } from "./findings";
import type { ScenarioNode } from "./nodes";
import type { TimelineEvent } from "./events";
import type { ScenarioStep } from "./steps";

export interface MutationConfig {
  id: string;
  label: string;
  description: string;
  target: "token" | "header" | "edge" | "policy" | "credentialProvider" | "session" | "sigv4";
  enabled?: boolean;
  expectedFinding: string;
}

export interface Scenario {
  schemaVersion: "1.0";
  id: string;
  name: string;
  description: string;
  nodes: ScenarioNode[];
  edges: ScenarioEdge[];
  steps?: ScenarioStep[];
  selectedPath?: string[];
  initialUserPrompt: string;
  mutations: MutationConfig[];
  expectedLearningOutcomes: string[];
}

export interface SimulationInput {
  scenario: Scenario;
  steps?: ScenarioStep[];
  userPrompt: string;
  mutations: MutationConfig[];
}

export interface SimulationResult {
  status: "success" | "failed" | "partial";
  events: TimelineEvent[];
  steps: ScenarioStep[];
  securityFindings: SecurityFinding[];
  generatedArtifacts: {
    mermaid: string;
    curlSnippets: string[];
    traceJson: object;
  };
}

export const scenarioSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodes: z.array(z.record(z.unknown())),
  edges: z.array(z.record(z.unknown())),
  steps: z.array(z.record(z.unknown())).optional(),
  selectedPath: z.array(z.string()).optional(),
  initialUserPrompt: z.string(),
  mutations: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      target: z.enum(["token", "header", "edge", "policy", "credentialProvider", "session", "sigv4"]),
      enabled: z.boolean().optional(),
      expectedFinding: z.string()
    })
  ),
  expectedLearningOutcomes: z.array(z.string())
});
