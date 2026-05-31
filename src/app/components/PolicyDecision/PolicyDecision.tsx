import type { PolicyDecision as Decision } from "../../../model/events";

export function PolicyDecision({ decision }: { decision?: Decision }) {
  if (!decision) return <div className="p-3 text-xs text-console-muted">No policy decision for this step.</div>;
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="border border-console-line bg-console-rail p-2">
          <div className="field-label">Engine</div>
          <div className="truncate font-mono">{decision.engineId}</div>
        </div>
        <div className="border border-console-line bg-console-rail p-2">
          <div className="field-label">Default Deny</div>
          <div className={decision.defaultDeny ? "status-warn" : "status-allow"}>{decision.defaultDeny ? "yes" : "no"}</div>
        </div>
        <div className="border border-console-line bg-console-rail p-2">
          <div className="field-label">Mode</div>
          <div>{decision.mode}</div>
        </div>
        <div className="border border-console-line bg-console-rail p-2">
          <div className="field-label">Effect</div>
          <div className={decision.effect === "allow" ? "status-allow" : "status-deny"}>{decision.effect}</div>
        </div>
      </div>
      <div>
        <div className="field-label">Matched Policies</div>
        <div className="font-mono text-console-muted">{decision.matchedPolicies.length ? decision.matchedPolicies.join(", ") : "none"}</div>
      </div>
      <p className="text-console-muted">{decision.explanation}</p>
    </div>
  );
}
