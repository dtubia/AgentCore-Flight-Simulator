import { create } from "zustand";
import { applyNodeChanges, type Edge as FlowEdge, type Node as FlowNode, type NodeChange } from "@xyflow/react";
import { scenarios } from "../scenarios";
import type { Scenario } from "../model/schema";
import type { TimelineEvent } from "../model/events";
import type { SimulationResult } from "../model/schema";
import { scenarioSchema } from "../model/schema";
import { isControlPlaneEdgeKind } from "../model/edges";
import { simulateScenario } from "../engine/simulate";
import type { ScenarioStep } from "../model/steps";
import { buildMagicSteps, normalizeScenarioSteps, renumberSteps, stepFromEdge } from "../model/steps";

const STORAGE_KEY = "agentcore-flight-simulator-scenario-v1";

function cloneScenario(scenario: Scenario): Scenario {
  return normalizeScenarioSteps(JSON.parse(JSON.stringify(scenario)) as Scenario);
}

function initialScenario(): Scenario {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      if (/cognito/i.test(saved)) {
        localStorage.removeItem(STORAGE_KEY);
        return cloneScenario(scenarios[0]);
      }
      const parsed = JSON.parse(saved) as unknown;
      const result = scenarioSchema.safeParse(parsed);
      if (!result.success) {
        localStorage.removeItem(STORAGE_KEY);
        return cloneScenario(scenarios[0]);
      }
      return normalizeScenarioSteps(parsed as Scenario);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return cloneScenario(scenarios[0]);
}

export interface AppState {
  scenario: Scenario;
  result?: SimulationResult;
  runError?: string;
  selectedEventId?: string;
  selectedStepId?: string;
  userPrompt: string;
  scenarioJsonDraft: string;
  scenarioJsonError?: string;
  loadScenario: (scenarioId: string) => Promise<void>;
  run: () => Promise<void>;
  selectEvent: (eventId: string) => void;
  selectStep: (stepId: string) => void;
  setUserPrompt: (prompt: string) => void;
  toggleMutation: (id: string) => Promise<void>;
  setScenario: (scenario: Scenario) => Promise<void>;
  updateNodes: (changes: NodeChange[]) => void;
  addNode: (node: Scenario["nodes"][number]) => Promise<void>;
  updateNode: (nodeId: string, patch: Partial<Scenario["nodes"][number]>) => Promise<void>;
  addEdge: (edge: Scenario["edges"][number]) => Promise<void>;
  updateEdge: (edgeId: string, patch: Partial<Scenario["edges"][number]>) => Promise<void>;
  deleteEdge: (edgeId: string) => Promise<void>;
  addStepForEdge: (edgeId: string) => Promise<void>;
  updateStep: (stepId: string, patch: Partial<ScenarioStep>) => Promise<void>;
  removeStep: (stepId: string) => Promise<void>;
  duplicateStep: (stepId: string) => Promise<void>;
  moveStep: (stepId: string, direction: -1 | 1) => Promise<void>;
  reorderStep: (stepId: string, toIndex: number) => Promise<void>;
  magicPath: () => Promise<void>;
  setSelectedPath: (edgeIds: string[]) => Promise<void>;
  addPathEdge: (edgeId: string) => Promise<void>;
  removePathEdge: (edgeId: string) => Promise<void>;
  movePathEdge: (edgeId: string, direction: -1 | 1) => Promise<void>;
  setScenarioJsonDraft: (draft: string) => void;
  importScenarioDraft: (draftOverride?: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => {
  const scenario = initialScenario();
  return {
    scenario,
    runError: undefined,
    userPrompt: scenario.initialUserPrompt,
    scenarioJsonDraft: JSON.stringify(scenario, null, 2),
    async loadScenario(scenarioId) {
      const selected = cloneScenario(scenarios.find((item) => item.id === scenarioId) ?? scenarios[0]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
      set({ scenario: selected, userPrompt: selected.initialUserPrompt, scenarioJsonDraft: JSON.stringify(selected, null, 2), scenarioJsonError: undefined, selectedEventId: undefined, selectedStepId: selected.steps?.[0]?.id });
      await get().run();
    },
    async run() {
      const { scenario, userPrompt, selectedStepId } = get();
      const normalized = normalizeScenarioSteps(scenario);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      try {
        const result = await simulateScenario({ scenario: normalized, steps: normalized.steps, userPrompt, mutations: normalized.mutations });
        const nextScenario = { ...normalized, steps: result.steps };
        const selectedEvent = selectedStepId ? result.events.find((event) => event.stepId === selectedStepId) : undefined;
        set({
          scenario: nextScenario,
          result,
          runError: undefined,
          selectedEventId: selectedEvent?.id ?? result.events[0]?.id,
          selectedStepId: selectedStepId ?? result.steps[0]?.id,
          scenarioJsonDraft: JSON.stringify(nextScenario, null, 2),
          scenarioJsonError: undefined
        });
      } catch (error) {
        set({ runError: error instanceof Error ? error.message : "Simulation failed." });
      }
    },
    selectEvent(eventId) {
      const event = get().result?.events.find((item) => item.id === eventId);
      set({ selectedEventId: eventId, selectedStepId: event?.stepId ?? get().selectedStepId });
    },
    selectStep(stepId) {
      const event = get().result?.events.find((item) => item.stepId === stepId);
      set({ selectedStepId: stepId, selectedEventId: event?.id ?? get().selectedEventId });
    },
    setUserPrompt(prompt) {
      set({ userPrompt: prompt });
    },
    async toggleMutation(id) {
      const scenario = cloneScenario(get().scenario);
      scenario.mutations = scenario.mutations.map((mutation) => (mutation.id === id ? { ...mutation, enabled: !mutation.enabled } : mutation));
      await get().setScenario(scenario);
      await get().run();
    },
    async setScenario(scenario) {
      const normalized = normalizeScenarioSteps(scenario);
      delete normalized.selectedPath;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      set({ scenario: normalized, scenarioJsonDraft: JSON.stringify(normalized, null, 2), scenarioJsonError: undefined });
    },
    updateNodes(changes) {
      const scenario = cloneScenario(get().scenario);
      const flowNodes: FlowNode[] = scenario.nodes.map((node) => ({ id: node.id, position: node.position ?? { x: 0, y: 0 }, data: { label: node.displayName ?? node.id } }));
      const updated = applyNodeChanges(changes, flowNodes);
      scenario.nodes = scenario.nodes.map((node) => {
        const flowNode = updated.find((item) => item.id === node.id);
        return flowNode ? { ...node, position: flowNode.position } : node;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
      set({ scenario, scenarioJsonDraft: JSON.stringify(scenario, null, 2) });
    },
    async addNode(node) {
      const scenario = cloneScenario(get().scenario);
      scenario.nodes.push(node);
      await get().setScenario(scenario);
    },
    async updateNode(nodeId, patch) {
      const scenario = cloneScenario(get().scenario);
      scenario.nodes = scenario.nodes.map((node) => (node.id === nodeId ? ({ ...node, ...patch } as Scenario["nodes"][number]) : node));
      await get().setScenario(scenario);
      await get().run();
    },
    async addEdge(edge) {
      const scenario = cloneScenario(get().scenario);
      scenario.edges.push(edge);
      scenario.steps = renumberSteps([...(scenario.steps ?? []), stepFromEdge(edge, (scenario.steps?.length ?? 0) + 1, scenario.nodes)]);
      await get().setScenario(scenario);
      await get().run();
    },
    async updateEdge(edgeId, patch) {
      const scenario = cloneScenario(get().scenario);
      scenario.edges = scenario.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge));
      const edge = scenario.edges.find((item) => item.id === edgeId);
      if (edge) {
        scenario.steps = (scenario.steps ?? []).map((step) => {
          if (step.edgeId !== edgeId) return step;
          const inferred = stepFromEdge(edge, step.order, scenario.nodes);
          return { ...inferred, ...step, sourceNodeId: edge.source, targetNodeId: edge.target };
        });
      }
      await get().setScenario(scenario);
      await get().run();
    },
    async deleteEdge(edgeId) {
      const scenario = cloneScenario(get().scenario);
      scenario.edges = scenario.edges.filter((edge) => edge.id !== edgeId);
      scenario.steps = renumberSteps((scenario.steps ?? []).filter((step) => step.edgeId !== edgeId));
      await get().setScenario(scenario);
      await get().run();
    },
    async addStepForEdge(edgeId) {
      const scenario = cloneScenario(get().scenario);
      const edge = scenario.edges.find((item) => item.id === edgeId);
      if (!edge) return;
      const id = `step-${edge.id}-${Date.now().toString(36)}`;
      scenario.steps = renumberSteps([...(scenario.steps ?? []), { ...stepFromEdge(edge, (scenario.steps?.length ?? 0) + 1, scenario.nodes), id }]);
      await get().setScenario(scenario);
      await get().run();
    },
    async updateStep(stepId, patch) {
      const scenario = cloneScenario(get().scenario);
      scenario.steps = (scenario.steps ?? []).map((step) => (step.id === stepId ? { ...step, ...patch } : step));
      await get().setScenario(scenario);
      await get().run();
    },
    async removeStep(stepId) {
      const scenario = cloneScenario(get().scenario);
      scenario.steps = renumberSteps((scenario.steps ?? []).filter((step) => step.id !== stepId));
      await get().setScenario(scenario);
      await get().run();
    },
    async duplicateStep(stepId) {
      const scenario = cloneScenario(get().scenario);
      const index = (scenario.steps ?? []).findIndex((step) => step.id === stepId);
      if (index < 0) return;
      const duplicate = { ...scenario.steps![index], id: `${scenario.steps![index].id}-copy-${Date.now().toString(36)}`, status: "idle" as const };
      scenario.steps = renumberSteps([...scenario.steps!.slice(0, index + 1), duplicate, ...scenario.steps!.slice(index + 1)]);
      await get().setScenario(scenario);
      await get().run();
    },
    async moveStep(stepId, direction) {
      const scenario = cloneScenario(get().scenario);
      const steps = [...(scenario.steps ?? [])].sort((a, b) => a.order - b.order);
      const index = steps.findIndex((step) => step.id === stepId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= steps.length) return;
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      scenario.steps = renumberSteps(steps);
      await get().setScenario(scenario);
      await get().run();
    },
    async reorderStep(stepId, toIndex) {
      const scenario = cloneScenario(get().scenario);
      const steps = [...(scenario.steps ?? [])].sort((a, b) => a.order - b.order);
      const fromIndex = steps.findIndex((step) => step.id === stepId);
      if (fromIndex < 0 || toIndex < 0 || toIndex >= steps.length || fromIndex === toIndex) return;
      const [moved] = steps.splice(fromIndex, 1);
      steps.splice(toIndex, 0, moved);
      scenario.steps = renumberSteps(steps);
      await get().setScenario(scenario);
      await get().run();
    },
    async magicPath() {
      const scenario = cloneScenario(get().scenario);
      scenario.steps = buildMagicSteps(scenario.edges, scenario.nodes);
      await get().setScenario(scenario);
      await get().run();
    },
    async setSelectedPath(edgeIds) {
      const scenario = cloneScenario(get().scenario);
      const validEdgeIds = new Set(scenario.edges.map((edge) => edge.id));
      const next = edgeIds.filter((edgeId, index, list) => validEdgeIds.has(edgeId) && list.indexOf(edgeId) === index);
      scenario.steps = next.map((edgeId, index) => stepFromEdge(scenario.edges.find((edge) => edge.id === edgeId)!, index + 1, scenario.nodes));
      await get().setScenario(scenario);
      await get().run();
    },
    async addPathEdge(edgeId) {
      const scenario = cloneScenario(get().scenario);
      if (!scenario.edges.some((edge) => edge.id === edgeId)) return;
      const edge = scenario.edges.find((item) => item.id === edgeId)!;
      scenario.steps = renumberSteps([...(scenario.steps ?? []), stepFromEdge(edge, (scenario.steps?.length ?? 0) + 1, scenario.nodes)]);
      await get().setScenario(scenario);
      await get().run();
    },
    async removePathEdge(edgeId) {
      const scenario = cloneScenario(get().scenario);
      scenario.steps = renumberSteps((scenario.steps ?? []).filter((step) => step.edgeId !== edgeId));
      await get().setScenario(scenario);
      await get().run();
    },
    async movePathEdge(edgeId, direction) {
      const scenario = cloneScenario(get().scenario);
      const current = [...(scenario.steps ?? [])].sort((a, b) => a.order - b.order);
      const index = current.findIndex((step) => step.edgeId === edgeId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
      [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
      scenario.steps = renumberSteps(current);
      await get().setScenario(scenario);
      await get().run();
    },
    setScenarioJsonDraft(draft) {
      set({ scenarioJsonDraft: draft, scenarioJsonError: undefined });
    },
    async importScenarioDraft(draftOverride) {
      try {
        const draft = draftOverride ?? get().scenarioJsonDraft;
        const parsed = JSON.parse(draft) as unknown;
        const validation = scenarioSchema.safeParse(parsed);
        if (!validation.success) {
          set({ scenarioJsonError: validation.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("\n") });
          return;
        }
        const imported = parsed as Scenario;
        set({ scenarioJsonDraft: draft });
        await get().setScenario(imported);
        await get().run();
      } catch (error) {
        set({ scenarioJsonError: error instanceof Error ? error.message : "Invalid JSON." });
      }
    }
  };
});

export function flowEdgesFromScenario(scenario: Scenario): FlowEdge[] {
  return scenario.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "default",
    sourceHandle: isControlPlaneEdgeKind(edge.kind) ? "control" : "out",
    targetHandle: isControlPlaneEdgeKind(edge.kind) ? "control" : "in",
    data: { ...edge },
    reconnectable: true,
    selectable: true,
    deletable: true,
    interactionWidth: 24,
    animated: edge.authMode === "AWS_IAM_SIGV4" || edge.invalid,
    style: {
      stroke: edge.invalid ? "#ff4d4d" : edge.authMode === "AWS_IAM_SIGV4" ? "#f4b454" : "#39c5bb",
      strokeWidth: edge.invalid ? 3 : 2,
      strokeDasharray: edge.invalid || edge.kind.includes("direct") ? "8 5" : undefined,
      filter: edge.invalid ? "drop-shadow(0 0 7px rgba(255, 77, 77, 0.55))" : "drop-shadow(0 0 5px rgba(57, 197, 187, 0.28))"
    }
  }));
}

export function flowNodesFromScenario(scenario: Scenario): FlowNode[] {
  const nodeWidth = 170;
  return scenario.nodes.map((node) => ({
    id: node.id,
    type: "mission",
    position: node.position ?? { x: 0, y: 0 },
    data: { label: `${node.displayName ?? node.id}\n${node.type}`, assetType: node.type },
    width: nodeWidth,
    height: 62,
    initialWidth: nodeWidth,
    initialHeight: 62
  }));
}
