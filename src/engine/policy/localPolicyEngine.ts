import type { PolicyDecision } from "../../model/events";
import type { LocalPolicy } from "../../model/nodes";

export interface PolicyContext {
  principal: Record<string, unknown>;
  context: Record<string, unknown>;
  arguments: Record<string, unknown>;
}

function splitTopLevel(input: string, operator: "||" | "&&"): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if ((char === "'" || char === '"') && input[i - 1] !== "\\") quote = quote === char ? null : quote ?? char;
    if (!quote && char === "(") depth += 1;
    if (!quote && char === ")") depth -= 1;
    if (!quote && depth === 0 && input.slice(i, i + operator.length) === operator) {
      parts.push(input.slice(start, i).trim());
      start = i + operator.length;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

function resolvePath(path: string, ctx: PolicyContext): unknown {
  const [root, ...rest] = path.split(".");
  if (!["principal", "context", "arguments"].includes(root)) return undefined;
  let value: unknown = ctx[root as keyof PolicyContext];
  for (const segment of rest) {
    if (value && typeof value === "object" && segment in value) {
      value = (value as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return value;
}

function literalOrPath(raw: string, ctx: PolicyContext): unknown {
  const value = raw.trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return resolvePath(value, ctx);
}

function tagValue(name: string, ctx: PolicyContext): unknown {
  const tags = ctx.principal.tags;
  if (tags && typeof tags === "object") return (tags as Record<string, unknown>)[name];
  return ctx.principal[name];
}

function wildcardLike(value: unknown, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(String(value ?? ""));
}

export function evaluateCondition(condition: string | undefined, ctx: PolicyContext): boolean {
  if (!condition?.trim()) return true;
  const orParts = splitTopLevel(condition, "||");
  if (orParts.length > 1) return orParts.some((part) => evaluateCondition(part, ctx));
  const andParts = splitTopLevel(condition, "&&");
  if (andParts.length > 1) return andParts.every((part) => evaluateCondition(part, ctx));

  const expression = condition.trim().replace(/^\((.*)\)$/, "$1").trim();
  const hasTag = expression.match(/^principal\.hasTag\((.+)\)$/);
  if (hasTag) {
    const tagName = literalOrPath(hasTag[1], ctx);
    return typeof tagName === "string" && tagValue(tagName, ctx) !== undefined;
  }

  const getTagCompare = expression.match(/^principal\.getTag\((['"][^'"]+['"])\)\s*(==|!=|like)\s*(.+)$/);
  if (getTagCompare) {
    const tagName = literalOrPath(getTagCompare[1], ctx);
    const left = typeof tagName === "string" ? tagValue(tagName, ctx) : undefined;
    const right = literalOrPath(getTagCompare[3], ctx);
    if (getTagCompare[2] === "like") return typeof right === "string" && wildcardLike(left, right);
    return getTagCompare[2] === "==" ? left === right : left !== right;
  }

  const includes = expression.match(/^([a-zA-Z][\w.]+)\.includes\((.+)\)$/);
  if (includes) {
    const collection = resolvePath(includes[1], ctx);
    const needle = literalOrPath(includes[2], ctx);
    return Array.isArray(collection) && collection.includes(needle);
  }

  const compare = expression.match(/^([a-zA-Z][\w.]+)\s*(==|!=|>=|<=|>|<|like)\s*(.+)$/);
  if (!compare) return false;
  const left = resolvePath(compare[1], ctx);
  const right = literalOrPath(compare[3], ctx);
  switch (compare[2]) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return Number(left) > Number(right);
    case "<":
      return Number(left) < Number(right);
    case ">=":
      return Number(left) >= Number(right);
    case "<=":
      return Number(left) <= Number(right);
    case "like":
      return typeof right === "string" && wildcardLike(left, right);
    default:
      return false;
  }
}

function policyMatches(policy: LocalPolicy, principal: string, action: string, resource: string, ctx: PolicyContext): boolean {
  const principalMatches = policy.principal === "*" || policy.principal === principal;
  const actionMatches = policy.action === "*" || policy.action === action;
  const resourceMatches = !policy.resource || policy.resource === "*" || policy.resource === resource;
  return principalMatches && actionMatches && resourceMatches && evaluateCondition(policy.condition, ctx);
}

export function evaluatePolicies(args: {
  engineId: string;
  mode: "LOG_ONLY" | "ENFORCE";
  policies: LocalPolicy[];
  principal: string;
  action: string;
  resource: string;
  context: PolicyContext;
}): PolicyDecision {
  const matchingDenies = args.policies.filter(
    (policy) => policy.effect === "deny" && policyMatches(policy, args.principal, args.action, args.resource, args.context)
  );
  if (matchingDenies.length) {
    return {
      engineId: args.engineId,
      mode: args.mode,
      effect: args.mode === "LOG_ONLY" ? "allow" : "deny",
      matchedPolicies: matchingDenies.map((policy) => policy.id),
      defaultDeny: false,
      explanation:
        args.mode === "LOG_ONLY"
          ? "Explicit deny matched, but LOG_ONLY mode records the deny without blocking execution."
          : "Explicit deny matched and ENFORCE mode blocks the tool call."
    };
  }

  const matchingAllows = args.policies.filter(
    (policy) => policy.effect === "allow" && policyMatches(policy, args.principal, args.action, args.resource, args.context)
  );
  if (matchingAllows.length) {
    return {
      engineId: args.engineId,
      mode: args.mode,
      effect: "allow",
      matchedPolicies: matchingAllows.map((policy) => policy.id),
      defaultDeny: false,
      explanation: "At least one allow policy matched and no explicit deny matched."
    };
  }

  return {
    engineId: args.engineId,
    mode: args.mode,
    effect: args.mode === "LOG_ONLY" ? "allow" : "deny",
    matchedPolicies: [],
    defaultDeny: true,
    explanation:
      args.mode === "LOG_ONLY"
        ? "No allow policy matched. LOG_ONLY mode records default deny but permits the call."
        : "No allow policy matched. ENFORCE mode denies by default."
  };
}

export function filterPotentiallyAllowedTools<T extends { name: string }>(
  policies: LocalPolicy[],
  principal: string,
  tools: T[]
): T[] {
  return tools.filter((tool) =>
    policies.some(
      (policy) =>
        policy.effect === "allow" &&
        (policy.principal === "*" || policy.principal === principal) &&
        (policy.action === "*" || policy.action === tool.name)
    )
  );
}
