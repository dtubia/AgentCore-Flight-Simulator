import { ArrowDown, ArrowUp, Copy, GripVertical, Play, Plus, Route, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EDGE_LABELS } from "../../../model/edges";
import type { ScenarioStep, StepActionKind, StepAuthStrategy } from "../../../model/steps";
import { useAppStore } from "../../store";

const stepColumns = "20px 46px 92px minmax(220px,1.1fr) 150px 176px minmax(190px,1fr) 94px 138px";

const actionOptions: StepActionKind[] = [
  "user_open_client",
  "oauth_authorization_code_pkce",
  "runtime_invoke",
  "workload_identity_token",
  "gateway_tools_list_call",
  "gateway_policy_evaluation",
  "identity_resource_token",
  "identity_keycloak_provider",
  "gateway_mcp_target_call",
  "direct_mcp_call",
  "direct_a2a",
  "gateway_runtime_sigv4_proxy",
  "external_api_call",
  "generic_topology_call"
];

const authOptions: StepAuthStrategy[] = [
  "none",
  "oauth_authorization_code_pkce",
  "oauth_bearer",
  "oauth_token_exchange_obo",
  "oauth_client_credentials",
  "sigv4",
  "sigv4_with_forwarded_oauth",
  "api_key",
  "identity_provider",
  "policy"
];

function statusClass(status: ScenarioStep["status"]): string {
  if (status === "failed") return "border-console-red bg-console-red/12 text-console-red";
  if (status === "warning") return "border-console-amber bg-console-amber/12 text-console-amber";
  if (status === "success") return "border-console-green bg-console-green/10 text-console-green";
  if (status === "skipped") return "border-console-line bg-console-rail text-console-muted";
  if (status === "running") return "border-console-cyan bg-console-cyan/15 text-console-cyan";
  return "border-console-line bg-console-panel2 text-console-muted";
}

function edgeText(step: ScenarioStep, edge?: ReturnType<typeof useAppStore.getState>["scenario"]["edges"][number]) {
  if (!edge) return `${step.sourceNodeId} -> ${step.targetNodeId}`;
  return `${EDGE_LABELS[edge.kind]}: ${edge.source} -> ${edge.target}`;
}

export function Timeline() {
  const {
    scenario,
    result,
    selectedStepId,
    userPrompt,
    run,
    selectStep,
    addStepForEdge,
    updateStep,
    removeStep,
    duplicateStep,
    moveStep,
    reorderStep,
    magicPath
  } = useAppStore();
  const steps = useMemo(() => [...(result?.steps ?? scenario.steps ?? [])].sort((a, b) => a.order - b.order), [result?.steps, scenario.steps]);
  const [edgeToAdd, setEdgeToAdd] = useState("");
  const edgeById = useMemo(() => new Map(scenario.edges.map((edge) => [edge.id, edge])), [scenario.edges]);
  const nodeById = useMemo(() => new Map(scenario.nodes.map((node) => [node.id, node])), [scenario.nodes]);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!edgeToAdd && scenario.edges[0]) setEdgeToAdd(scenario.edges[0].id);
    if (edgeToAdd && !scenario.edges.some((edge) => edge.id === edgeToAdd)) setEdgeToAdd(scenario.edges[0]?.id ?? "");
  }, [edgeToAdd, scenario.edges]);

  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of result?.events ?? []) {
      if (event.stepId) counts.set(event.stepId, (counts.get(event.stepId) ?? 0) + 1);
    }
    return counts;
  }, [result?.events]);

  const toolOptionsForStep = (step: ScenarioStep): string[] => {
    const target = nodeById.get(step.targetNodeId);
    if (target?.type === "external_mcp_server" || target?.type === "agentcore_mcp_server") return target.tools.map((tool) => tool.name);
    const gatewayTargetEdges = scenario.edges.filter((edge) => edge.source === step.targetNodeId || edge.source === step.sourceNodeId);
    const tools = gatewayTargetEdges.flatMap((edge) => {
      const node = nodeById.get(edge.target);
      return node?.type === "external_mcp_server" || node?.type === "agentcore_mcp_server" ? node.tools.map((tool) => tool.name) : [];
    });
    return Array.from(new Set(tools));
  };

  const handleDragStart = (id: string) => {
    dragId.current = id;
  };

  const handleDrop = (targetId: string) => {
    const fromId = dragId.current;
    if (!fromId || fromId === targetId) { dragId.current = null; setDragOverId(null); return; }
    const toIndex = steps.findIndex((s) => s.id === targetId);
    if (toIndex < 0) { dragId.current = null; setDragOverId(null); return; }
    void reorderStep(fromId, toIndex);
    dragId.current = null;
    setDragOverId(null);
  };

  return (
    <div className="grid h-full grid-rows-[38px_minmax(0,1fr)] overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-console-line px-2 text-[10px] scrollbar-thin">
        <div className="flex flex-shrink-0 items-center gap-1 font-mono uppercase tracking-[0.08em] text-console-muted">
          <Route size={13} />
          <span>Steps</span>
        </div>
        <select
          data-testid="steps-edge-select"
          className="h-[26px] min-w-[250px] max-w-[360px] flex-shrink-0 border border-console-line bg-console-rail px-2 font-mono text-[10px] text-console-text"
          value={edgeToAdd}
          onChange={(event) => setEdgeToAdd(event.target.value)}
        >
          {scenario.edges.map((edge) => (
            <option key={edge.id} value={edge.id}>{`${edge.invalid ? "INVALID " : ""}${EDGE_LABELS[edge.kind]}: ${edge.source} -> ${edge.target}`}</option>
          ))}
        </select>
        <button data-testid="steps-add" className="inline-flex h-[26px] flex-shrink-0 items-center gap-1 border border-console-cyan/70 px-2 text-console-cyan hover:bg-console-cyan/10 disabled:opacity-40" disabled={!edgeToAdd} onClick={() => void addStepForEdge(edgeToAdd)}>
          <Plus size={12} /> Add Step
        </button>
        <button data-testid="steps-magic-path" className="inline-flex h-[26px] flex-shrink-0 items-center gap-1 border border-console-amber/70 px-2 text-console-amber hover:bg-console-amber/10" onClick={() => void magicPath()}>
          <Wand2 size={12} /> Magic Path
        </button>
        <button data-testid="steps-simulate" className="inline-flex h-[26px] flex-shrink-0 items-center gap-1 border border-console-green/70 px-2 text-console-green hover:bg-console-green/10" onClick={() => void run()}>
          <Play size={12} /> Simulate
        </button>
        <div className="ml-auto flex flex-shrink-0 items-center gap-2 font-mono text-console-muted">
          <span>{steps.length} steps</span>
          <span className="max-w-[360px] truncate" title={userPrompt}>{userPrompt}</span>
        </div>
      </div>

      <div className="min-h-0 overflow-auto scrollbar-thin" data-testid="steps-scroll">
        <div className="sticky top-0 z-10 grid min-w-[1280px] border-b border-console-line bg-console-panel px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-console-muted" style={{ gridTemplateColumns: stepColumns }}>
          <span />
          <span>#</span>
          <span>Status</span>
          <span>Diagram Action</span>
          <span>Action</span>
          <span>Auth</span>
          <span>Resource / Tool</span>
          <span>Branch</span>
          <span>Controls</span>
        </div>
        {steps.length ? steps.map((step, index) => {
          const selected = selectedStepId === step.id;
          const edge = edgeById.get(step.edgeId);
          const invalid = Boolean(edge?.invalid);
          const tools = toolOptionsForStep(step);
          const isDragTarget = dragOverId === step.id;
          return (
            <div
              key={step.id}
              data-testid={`step-row-${step.id}`}
              draggable
              onDragStart={() => handleDragStart(step.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(step.id); }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={() => handleDrop(step.id)}
              onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
              className={`grid min-w-[1280px] items-center gap-2 border-b px-2 py-1.5 text-left text-[10px] ${isDragTarget ? "border-console-cyan border-t-2" : ""} ${selected ? "border-console-cyan bg-console-cyan/14 ring-1 ring-inset ring-console-cyan" : invalid ? "border-console-red/60 bg-console-red/8" : "border-console-line bg-console-panel2 hover:border-console-cyan/60"}`}
              style={{ gridTemplateColumns: stepColumns }}
              onClick={() => selectStep(step.id)}
            >
              <span className="flex cursor-grab items-center justify-center text-console-muted active:cursor-grabbing" title="Drag to reorder" onClick={(e) => e.stopPropagation()}>
                <GripVertical size={12} />
              </span>
              <button className="text-left font-mono text-console-muted" onClick={() => selectStep(step.id)}>#{index + 1}</button>
              <span className={`inline-flex w-fit border px-1.5 py-1 font-mono uppercase ${statusClass(step.status)}`}>{step.status ?? "idle"}</span>
              <button className="min-w-0 text-left" title={edgeText(step, edge)} onClick={() => selectStep(step.id)}>
                <span className="block truncate font-semibold text-console-text">{edgeText(step, edge)}</span>
                <span className={invalid ? "block truncate font-mono text-console-red" : "block truncate font-mono text-console-muted"}>{invalid ? edge?.invalidReason : `${eventCounts.get(step.id) ?? 0} protocol events`}</span>
              </button>
              <select className="h-[28px] min-w-0 border border-console-line bg-console-rail px-1 font-mono text-[10px] text-console-text" value={step.actionKind} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStep(step.id, { actionKind: event.target.value as StepActionKind })}>
                {actionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select className="h-[28px] min-w-0 border border-console-line bg-console-rail px-1 font-mono text-[10px] text-console-text" value={step.authStrategy} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStep(step.id, { authStrategy: event.target.value as StepAuthStrategy })}>
                {authOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
                <div className="truncate border border-console-line bg-console-rail px-1.5 py-1 font-mono text-console-muted" title={step.resource}>{step.resource ?? "resource:auto"}</div>
                <select className="h-[26px] min-w-0 border border-console-line bg-console-rail px-1 font-mono text-[10px] text-console-text" value={step.toolName ?? ""} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStep(step.id, { toolName: event.target.value || undefined })}>
                  <option value="">tool:auto</option>
                  {tools.map((tool) => <option key={tool} value={tool}>{tool}</option>)}
                </select>
              </div>
              <select className="h-[28px] min-w-0 border border-console-line bg-console-rail px-1 font-mono text-[10px] text-console-text" value={step.branchId ?? "main"} onClick={(event) => event.stopPropagation()} onChange={(event) => void updateStep(step.id, { branchId: event.target.value === "main" ? undefined : event.target.value })}>
                <option value="main">main</option>
                <option value="direct">direct</option>
                <option value="gateway">gateway</option>
                <option value="identity">identity</option>
              </select>
              <div className="flex items-center gap-1">
                <button aria-label="Move step up" title="Move up" className="border border-console-line p-1 text-console-muted hover:border-console-cyan hover:text-console-cyan disabled:opacity-30" disabled={index === 0} onClick={(event) => { event.stopPropagation(); void moveStep(step.id, -1); }}><ArrowUp size={12} /></button>
                <button aria-label="Move step down" title="Move down" className="border border-console-line p-1 text-console-muted hover:border-console-cyan hover:text-console-cyan disabled:opacity-30" disabled={index === steps.length - 1} onClick={(event) => { event.stopPropagation(); void moveStep(step.id, 1); }}><ArrowDown size={12} /></button>
                <button aria-label="Duplicate step" title="Duplicate" className="border border-console-line p-1 text-console-muted hover:border-console-cyan hover:text-console-cyan" onClick={(event) => { event.stopPropagation(); void duplicateStep(step.id); }}><Copy size={12} /></button>
                <button aria-label="Delete step" title="Delete" className="border border-console-line p-1 text-console-muted hover:border-console-red hover:text-console-red" onClick={(event) => { event.stopPropagation(); void removeStep(step.id); }}><Trash2 size={12} /></button>
              </div>
            </div>
          );
        }) : (
          <div className="p-3 text-[11px] text-console-muted">No steps yet. Create a connection or use Magic Path.</div>
        )}
      </div>
    </div>
  );
}
