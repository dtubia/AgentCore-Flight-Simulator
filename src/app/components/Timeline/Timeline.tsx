import { ChevronLeft, ChevronRight, Plus, Route, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EDGE_LABELS } from "../../../model/edges";
import type { TimelineEvent } from "../../../model/events";
import { useAppStore } from "../../store";

type TimelineSort = "index" | "protocol" | "outcome";
type ScenarioEdge = ReturnType<typeof useAppStore.getState>["scenario"]["edges"][number];
const eventGridColumns = "50px 86px minmax(260px,1.3fr) 130px minmax(200px,1fr) minmax(220px,1fr)";

function edgeLabel(edge: ScenarioEdge): string {
  return edge.label ?? EDGE_LABELS[edge.kind];
}

function eventSortValue(event: TimelineEvent, sort: TimelineSort): string | number {
  if (sort === "protocol") return `${event.protocol}-${event.index.toString().padStart(3, "0")}`;
  if (sort === "outcome") return `${event.verdict.outcome}-${event.index.toString().padStart(3, "0")}`;
  return event.index;
}

export function Timeline() {
  const { scenario, result, selectedEventId, selectEvent, addPathEdge, removePathEdge, movePathEdge, setSelectedPath } = useAppStore();
  const [edgeToAdd, setEdgeToAdd] = useState("");
  const [sort, setSort] = useState<TimelineSort>("index");
  const pathIds = scenario.selectedPath ?? [];
  const edgeById = useMemo(() => new Map(scenario.edges.map((edge) => [edge.id, edge])), [scenario.edges]);
  const pathEdges = pathIds.map((edgeId) => edgeById.get(edgeId)).filter((edge): edge is ScenarioEdge => Boolean(edge));
  const availableEdges = scenario.edges.filter((edge) => !pathIds.includes(edge.id));
  const selectedEvent = result?.events.find((event) => event.id === selectedEventId) ?? result?.events[0];
  const events = useMemo(() => {
    const list = [...(result?.events ?? [])];
    return list.sort((a, b) => {
      const av = eventSortValue(a, sort);
      const bv = eventSortValue(b, sort);
      return typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    });
  }, [result?.events, sort]);

  useEffect(() => {
    if (!edgeToAdd && availableEdges[0]) setEdgeToAdd(availableEdges[0].id);
    if (edgeToAdd && !availableEdges.some((edge) => edge.id === edgeToAdd)) setEdgeToAdd(availableEdges[0]?.id ?? "");
  }, [availableEdges, edgeToAdd]);

  const derivePathFromRun = async () => {
    const next: string[] = [];
    for (const event of result?.events ?? []) {
      const matching = scenario.edges.find((edge) => edge.source === event.sourceNodeId && edge.target === event.targetNodeId);
      if (matching && !next.includes(matching.id)) next.push(matching.id);
    }
    await setSelectedPath(next);
  };

  return (
    <div className="grid h-full grid-rows-[38px_44px_minmax(0,1fr)] overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-console-line px-2 text-[10px] scrollbar-thin">
        <div className="flex flex-shrink-0 items-center gap-1 font-mono uppercase tracking-[0.08em] text-console-muted">
          <Route size={13} />
          <span>Path Builder</span>
        </div>
        <select data-testid="timeline-edge-select" className="h-[26px] min-w-[260px] max-w-[360px] flex-shrink-0 border border-console-line bg-console-rail px-2 font-mono text-[10px] text-console-text" value={edgeToAdd} onChange={(event) => setEdgeToAdd(event.target.value)}>
          {availableEdges.length ? availableEdges.map((edge) => (
            <option key={edge.id} value={edge.id}>{`${edge.invalid ? "INVALID " : ""}${edgeLabel(edge)}: ${edge.source} -> ${edge.target}`}</option>
          )) : <option value="">No more edges</option>}
        </select>
        <button data-testid="timeline-add-edge" className="inline-flex h-[26px] flex-shrink-0 items-center gap-1 border border-console-cyan/70 px-2 text-console-cyan hover:bg-console-cyan/10 disabled:opacity-40" disabled={!edgeToAdd} onClick={() => void addPathEdge(edgeToAdd)}>
          <Plus size={12} /> Add Step
        </button>
        <button data-testid="timeline-auto-path" className="inline-flex h-[26px] flex-shrink-0 items-center gap-1 border border-console-amber/70 px-2 text-console-amber hover:bg-console-amber/10" onClick={() => void derivePathFromRun()}>
          <Wand2 size={12} /> Magic Path
        </button>
        <button data-testid="timeline-clear-path" className="h-[26px] flex-shrink-0 border border-console-line px-2 text-console-muted hover:border-console-red hover:text-console-red" onClick={() => void setSelectedPath([])}>Clear Path</button>
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          <span className="font-mono uppercase tracking-[0.08em] text-console-muted">Sort</span>
          <select data-testid="timeline-sort-select" className="h-[26px] border border-console-line bg-console-rail px-2 font-mono text-[10px] text-console-text" value={sort} onChange={(event) => setSort(event.target.value as TimelineSort)}>
            <option value="index">Index</option>
            <option value="protocol">Protocol</option>
            <option value="outcome">Outcome</option>
          </select>
          <span className="font-mono text-console-muted">{events.length} events</span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-console-line bg-console-rail/40 px-2 scrollbar-thin">
        {pathEdges.length ? pathEdges.map((edge, index) => (
          <span key={edge.id} className={`inline-flex h-[30px] flex-shrink-0 items-center gap-1 border px-1.5 font-mono text-[10px] ${edge.invalid ? "border-console-red/70 bg-console-red/10 text-console-red" : "border-console-cyan/40 bg-console-cyan/10 text-console-cyan"}`}>
            <span className="max-w-[250px] truncate">{index + 1}. {edge.source} &gt; {edge.target}</span>
            <button title="Move earlier" className="border border-transparent p-0.5 hover:border-console-cyan disabled:opacity-30" disabled={index === 0} onClick={() => void movePathEdge(edge.id, -1)}><ChevronLeft size={12} /></button>
            <button title="Move later" className="border border-transparent p-0.5 hover:border-console-cyan disabled:opacity-30" disabled={index === pathEdges.length - 1} onClick={() => void movePathEdge(edge.id, 1)}><ChevronRight size={12} /></button>
            <button title="Remove from path" className="border border-transparent p-0.5 hover:border-console-red hover:text-console-red" onClick={() => void removePathEdge(edge.id)}><X size={12} /></button>
          </span>
        )) : (
          <div className="font-mono text-[10px] text-console-muted">Auto mode. Use Magic Path to materialize the current route, or add specific edges to analyze one branch.</div>
        )}
      </div>

      <div className="min-h-0 overflow-auto scrollbar-thin" data-testid="timeline-events-scroll">
        <div className="sticky top-0 z-10 grid min-w-[1100px] border-b border-console-line bg-console-panel px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-console-muted" style={{ gridTemplateColumns: eventGridColumns }}>
          <span>#</span>
          <span>Verdict</span>
          <span>Step</span>
          <span>Protocol</span>
          <span>Source</span>
          <span>Target</span>
        </div>
        {events.length ? events.map((event) => (
          <button
            key={event.id}
            aria-label={event.title}
            onClick={() => selectEvent(event.id)}
            className={`grid min-w-[1100px] border-b px-2 py-1.5 text-left text-[10px] ${selectedEvent?.id === event.id ? "border-console-cyan bg-console-cyan/10" : "border-console-line bg-console-panel2 hover:border-console-cyan/60"}`}
            style={{ gridTemplateColumns: eventGridColumns }}
          >
            <span className="font-mono text-console-muted">#{event.index}</span>
            <span className={`font-mono status-${event.verdict.outcome}`}>{event.verdict.outcome.toUpperCase()}</span>
            <span className="truncate font-semibold text-console-text">{event.title}</span>
            <span className="truncate font-mono text-console-muted">{event.protocol} {event.method}</span>
            <span className="truncate font-mono text-console-muted">{event.sourceNodeId}</span>
            <span className="truncate font-mono text-console-muted">{event.targetNodeId}</span>
          </button>
        )) : (
          <div className="p-3 text-[11px] text-console-muted">Run a scenario to materialize the timeline.</div>
        )}
      </div>
    </div>
  );
}
