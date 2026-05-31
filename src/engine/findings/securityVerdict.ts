import type { SecurityFinding } from "../../model/findings";

export function finding(args: SecurityFinding): SecurityFinding {
  return args;
}

export function uniqueFindings(findings: SecurityFinding[]): SecurityFinding[] {
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.type}:${item.title}:${item.affectedNodes.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
