import { useEffect } from "react";
import { AppShell, Panel } from "./layout/AppShell";
import { Palette } from "./components/Palette/Palette";
import { TopologyCanvas } from "./components/Canvas/TopologyCanvas";
import { Timeline } from "./components/Timeline/Timeline";
import { Inspectors } from "./components/Inspectors/Inspectors";
import { useAppStore } from "./store";

export function App() {
  const { run, result, runError, scenario } = useAppStore();
  useEffect(() => {
    void run();
  }, [run]);

  return (
    <AppShell>
      <div className="grid min-h-0 min-w-0 w-screen max-w-[100vw] grid-cols-[250px_minmax(620px,1fr)_360px] gap-2 overflow-hidden p-2 pb-1">
        <Panel title="Scenario" className="h-full">
          <Palette />
        </Panel>
        <Panel title="Topology" className="h-full">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-console-line px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{scenario.name}</span>
                <span className="flex-shrink-0 text-console-muted">{scenario.nodes.length} nodes / {scenario.edges.length} edges</span>
              </div>
              {runError ? (
                <div className="flex-shrink-0 truncate max-w-xs status-deny" title={runError}>error: {runError}</div>
              ) : (
                <div className={`flex-shrink-0 ${result?.status === "success" ? "status-allow" : result?.status === "failed" ? "status-deny" : "status-warn"}`}>{result?.status ?? "idle"}</div>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <TopologyCanvas />
            </div>
          </div>
        </Panel>
        <Inspectors />
      </div>
      <div className="min-h-0 p-2 pt-1">
        <Panel title="Steps" className="h-full">
          <Timeline />
        </Panel>
      </div>
    </AppShell>
  );
}
