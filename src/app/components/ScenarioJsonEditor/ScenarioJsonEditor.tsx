import Editor from "@monaco-editor/react";
import { useRef } from "react";
import { useAppStore } from "../../store";

export function ScenarioJsonEditor() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { scenario, scenarioJsonDraft, scenarioJsonError, setScenarioJsonDraft, importScenarioDraft } = useAppStore();
  const currentDraft = () => textareaRef.current?.value ?? scenarioJsonDraft;
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-console-line p-2">
        <button className="border border-console-cyan px-2 py-1 text-xs text-console-cyan" onClick={() => void importScenarioDraft(currentDraft())}>
          Import JSON
        </button>
        <button className="border border-console-line px-2 py-1 text-xs" onClick={() => navigator.clipboard.writeText(currentDraft())}>
          Export JSON
        </button>
      </div>
      {scenarioJsonError ? <pre data-testid="scenario-json-error" className="max-h-24 overflow-auto whitespace-pre-wrap border-b border-console-red/60 bg-console-red/10 p-2 text-[11px] text-console-red scrollbar-thin">{scenarioJsonError}</pre> : null}
      <textarea
        key={`${scenario.id}-${scenario.nodes.length}-${scenario.edges.length}`}
        ref={textareaRef}
        data-testid="scenario-json-textarea"
        className="h-28 resize-none border-b border-console-line bg-console-bg p-2 font-mono text-[11px] text-console-text outline-none focus:border-console-cyan"
        spellCheck={false}
        defaultValue={scenarioJsonDraft}
        onInput={(event) => setScenarioJsonDraft(event.currentTarget.value)}
      />
      <div className="min-h-0 flex-1">
        <Editor height="100%" language="json" theme="vs-dark" value={scenarioJsonDraft} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }} />
      </div>
    </div>
  );
}
