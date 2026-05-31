import { useAppStore } from "../../store";

export function SecurityVerdict() {
  const findings = useAppStore((state) => state.result?.securityFindings ?? []);
  return (
    <div className="space-y-2 overflow-auto p-3 scrollbar-thin">
      {findings.length === 0 ? <div className="text-xs text-console-muted">No findings for this run.</div> : null}
      {findings.map((finding, index) => (
        <div key={`${finding.type}-${index}`} className="border border-console-line bg-console-rail p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">{finding.title}</span>
            <span className={finding.severity === "high" || finding.severity === "critical" ? "status-deny" : finding.severity === "medium" ? "status-warn" : "status-info"}>{finding.severity}</span>
          </div>
          <p className="text-console-muted">{finding.explanation}</p>
          <p className="mt-2 text-console-cyan">{finding.remediation}</p>
        </div>
      ))}
    </div>
  );
}
