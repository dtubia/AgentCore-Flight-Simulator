import Editor from "@monaco-editor/react";
import { useAppStore } from "../../store";

export function MermaidExport() {
  const mermaid = useAppStore((state) => state.result?.generatedArtifacts.mermaid ?? "");
  return <Editor height="100%" language="markdown" theme="vs-dark" value={`\`\`\`mermaid\n${mermaid}\n\`\`\``} options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: "on" }} />;
}
