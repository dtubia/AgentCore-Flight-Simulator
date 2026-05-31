import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { Panel } from "../../layout/AppShell";
import { useAppStore } from "../../store";
import { TokenInspector } from "../TokenInspector/TokenInspector";
import { PolicyDecision } from "../PolicyDecision/PolicyDecision";
import { SecurityVerdict } from "../SecurityVerdict/SecurityVerdict";
import { MermaidExport } from "../MermaidExport/MermaidExport";
import { ScenarioJsonEditor } from "../ScenarioJsonEditor/ScenarioJsonEditor";

type InspectorTab = "request" | "response" | "token" | "policy" | "security" | "mermaid" | "json";

const tabs: { id: InspectorTab; label: string }[] = [
  { id: "request", label: "Request" },
  { id: "response", label: "Response" },
  { id: "token", label: "Token Inspector" },
  { id: "policy", label: "Policy Decision" },
  { id: "security", label: "Security Verdict" },
  { id: "mermaid", label: "Mermaid Export" },
  { id: "json", label: "Scenario JSON" }
];

function JsonEditor({ value }: { value: unknown }) {
  const serialized = JSON.stringify(value ?? {}, null, 2);
  return (
    <div className="grid h-full grid-rows-[1fr_110px]">
      <Editor height="100%" language="json" theme="vs-dark" value={serialized} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }} />
      <pre data-testid="json-inspector-text" className="overflow-auto border-t border-console-line bg-console-bg p-2 font-mono text-[10px] leading-4 text-console-muted scrollbar-thin">{serialized}</pre>
    </div>
  );
}

function SigV4Box() {
  const { result, selectedEventId } = useAppStore();
  const event = result?.events.find((item) => item.id === selectedEventId) ?? result?.events[0];
  if (!event?.sigv4) return null;
  const sigv4 = event.sigv4;
  return (
    <div className="border-t border-console-line p-3 text-xs">
      <div className="mb-2 font-semibold text-console-amber">SigV4 signing status</div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ["signature", sigv4.signatureValid],
          ["region", sigv4.regionValid],
          ["service", sigv4.serviceValid],
          ["clock", sigv4.clockSkewValid],
          ["action", sigv4.actionAllowed],
          ["resource", sigv4.resourceAllowed]
        ].map(([label, value]) => (
          <div key={String(label)} className="border border-console-line bg-console-rail p-2">
            <div className="field-label">{label}</div>
            <div className={value ? "status-allow" : "status-deny"}>{value ? "valid" : "failed"}</div>
          </div>
        ))}
      </div>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap border border-console-line bg-console-rail p-2 font-mono text-[11px] text-console-muted scrollbar-thin">{sigv4.stringToSign}</pre>
    </div>
  );
}

export function Inspectors() {
  const [tab, setTab] = useState<InspectorTab>("request");
  const { result, selectedEventId } = useAppStore();
  const event = useMemo(() => result?.events.find((item) => item.id === selectedEventId) ?? result?.events[0], [result, selectedEventId]);
  return (
    <Panel title={tabs.find((item) => item.id === tab)?.label ?? "Inspectors"} className="h-full">
      <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-console-line bg-console-rail p-2">
        {tabs.map((item) => (
          <button key={item.id} className={`px-2 py-1 text-[11px] ${tab === item.id ? "bg-console-cyan text-console-bg" : "bg-console-panel2 text-console-muted"}`} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {event ? (
        <div className="border-b border-console-line p-3 text-xs">
          <div className="font-semibold">{event.title}</div>
          <div className="font-mono text-console-muted">{event.sourceNodeId} -&gt; {event.targetNodeId} / {event.protocol}</div>
          <div className={`mt-1 status-${event.verdict.outcome}`}>{event.verdict.reason}</div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {tab === "request" ? <JsonEditor value={{ method: event?.method, url: event?.url, protocol: event?.protocol, traceId: event?.traceId, correlationId: event?.correlationId, ...event?.request, sigv4: event?.sigv4 }} /> : null}
        {tab === "response" ? <JsonEditor value={event?.response} /> : null}
        {tab === "token" ? <TokenInspector token={event?.token} /> : null}
        {tab === "policy" ? <PolicyDecision decision={event?.policyDecision} /> : null}
        {tab === "security" ? <SecurityVerdict /> : null}
        {tab === "mermaid" ? <MermaidExport /> : null}
        {tab === "json" ? <ScenarioJsonEditor /> : null}
      </div>
      {tab === "request" ? <SigV4Box /> : null}
      </div>
    </Panel>
  );
}
