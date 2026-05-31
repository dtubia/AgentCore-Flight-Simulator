import type { TokenArtifact } from "../../../model/auth";

export function TokenInspector({ token }: { token?: TokenArtifact }) {
  if (!token) return <div className="p-3 text-xs text-console-muted">No token generated for this step.</div>;
  const validation = token.validation;
  const rows = validation
    ? [
        ["signature", validation.signatureValid],
        ["issuer", validation.issuerValid],
        ["audience", validation.audienceValid],
        ["client", validation.clientValid],
        ["scopes", validation.scopesValid],
        ["expiry", validation.expiryValid],
        ["custom claims", validation.customClaimsValid]
      ]
    : [];
  return (
    <div className="space-y-3 p-3 text-xs">
      <div>
        <div className="field-label">Token Type</div>
        <div className="font-mono">{token.kind ?? "user-delegated"} / {token.label}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([label, value]) => (
          <div key={String(label)} className="border border-console-line bg-console-rail p-2">
            <div className="field-label">{label}</div>
            <div className={value ? "status-allow" : "status-deny"}>{value ? "valid" : "failed"}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="field-label">Bindings</div>
        <div className="font-mono text-console-muted">actor={token.boundActor ?? "n/a"} subject={token.boundSubject ?? "n/a"} audience={token.downstreamAudience ?? "n/a"}</div>
      </div>
      {validation?.errors.length ? <pre className="whitespace-pre-wrap border border-console-red/50 bg-console-red/10 p-2 text-console-red">{validation.errors.join("\n")}</pre> : null}
    </div>
  );
}
