# Step Model Redesign

**Date:** 2026-05-31  
**Status:** Approved

## Problem

The current `ScenarioStep` model has several issues that reduce educational clarity:

1. **`branchId`** — an implicit parallel-execution mechanism only used in "direct-vs-gateway" scenarios. Its semantics are unclear and can be replaced by `stopOnFailure: false` alone.
2. **MCP steps are one-to-one with edges** — real MCP exchanges always involve at least two round-trips (`tools/list` then `tools/call`). The current model conflates both into a single step, hiding the protocol detail.
3. **`toolName` has ambiguous scope** — it appears on all steps but only makes sense for `tools/call` requests.
4. **No `protocol` field** — the transport layer (HTTP, MCP, A2A, OAuth2, SigV4, Policy) must be inferred from `actionKind`, which is a snake_case internal identifier not aligned with AgentCore/MCP terminology.

## Design

### Model changes (`src/model/steps.ts`)

Add two new optional fields:

```typescript
export type StepProtocol = "HTTP" | "MCP" | "A2A" | "OAuth2" | "SigV4" | "Policy";
export type McpMethod  = "tools/list" | "tools/call" | "resources/read" | "prompts/list" | "initialize";
```

Add to `ScenarioStep`:

```typescript
protocol?: StepProtocol;  // inferred from edgeKind if absent
mcpMethod?: McpMethod;    // only meaningful when protocol = "MCP"
```

Remove from `ScenarioStep`:

```typescript
branchId?: string;        // REMOVED — stopOnFailure covers all cases
```

`toolName` is retained but its semantics are tightened: it is only editable/visible in the UI when `mcpMethod === "tools/call"`.

### Step generation (`stepFromEdge` / `buildMagicSteps`)

For **MCP edges** (`kind` contains `"mcp"` or target is a gateway/MCP node), generate **two steps** instead of one:

| Step suffix | `mcpMethod`  | `toolName`       | `order` |
|-------------|-------------|------------------|---------|
| `{edgeId}-list` | `tools/list`  | `undefined`      | N       |
| `{edgeId}-call` | `tools/call`  | first tool name  | N+1     |

For all other edges, generate a single step with `protocol` inferred from `edgeKind`:

| `edgeKind` pattern | `protocol` |
|--------------------|------------|
| `*_to_*_a2a`       | `A2A`      |
| `client_to_idp`, `*_authorization_server*` | `OAuth2` |
| `gateway_to_policy_engine` | `Policy` |
| `*sigv4*` or authMode `AWS_IAM_SIGV4` | `SigV4` |
| MCP edges (see above) | `MCP` |
| everything else    | `HTTP`     |

`buildMagicSteps` accumulates a running order counter so the two MCP steps are always consecutive.

`normalizeScenarioSteps` deduplication remains by `step.id` (not `edgeId`), which already supports multiple steps per edge.

### Simulation engine (`src/engine/simulate.ts`)

Remove the `comparison` / `stoppedBranches` parallel-branch logic from `eventsForSteps`. Replace with a single linear `stopped` flag governed exclusively by `stopOnFailure`. Steps in scenarios 04 and 05 that were previously on the `"direct"` branch keep `stopOnFailure: false`; their failure will not halt subsequent steps.

Before:
```typescript
const comparison = scenario.id.includes("direct-vs") || ...
const stoppedBranches = new Set<string>();
// branch-aware skip logic
```

After:
```typescript
let stopped = false;
// if (hasDeny && step.stopOnFailure !== false) stopped = true;
```

### Timeline UI (`src/app/components/Timeline/Timeline.tsx`)

Replace the **Branch** column with two new columns:

| Column     | Width    | Content |
|------------|----------|---------|
| `Protocol` | `80px`   | Badge showing `step.protocol` (inferred if absent) |
| `Method / Tool` | `minmax(160px,1fr)` | `mcpMethod` dropdown; `toolName` dropdown only when `mcpMethod === "tools/call"` |

Remove the `<select>` for `branchId` entirely.

Grid template change:
```
Before: "20px 46px 92px minmax(220px,1.1fr) 150px 176px minmax(190px,1fr) 94px 138px"
After:  "20px 46px 92px minmax(220px,1.1fr) 150px 176px 80px minmax(190px,1fr) 94px 138px"
```

### Scenario JSON files

Remove `branchId` from all steps in all 5 scenario files.

Split existing single MCP steps into list+call pairs in scenarios 01, 03, 04, 05:

- `01-google-drive-obo.json` — gateway MCP step → list + call (google_drive.search_files)
- `03-workday-policy-deny.json` — gateway MCP step → list + call (workday.get_compensation)
- `04-direct-vs-gateway-mcp.json` — direct MCP step + gateway MCP step → each becomes list+call
- `05-agent-to-agent-direct-vs-gateway.json` — gateway MCP step → list + call (runtime.invoke.PolicyReviewAgent)

## Affected Files

| File | Change |
|------|--------|
| `src/model/steps.ts` | Add `StepProtocol`, `McpMethod` types; update `ScenarioStep`; update `stepFromEdge`; update `buildMagicSteps` |
| `src/engine/simulate.ts` | Remove `comparison`/`stoppedBranches` logic in `eventsForSteps` |
| `src/app/components/Timeline/Timeline.tsx` | Replace Branch column; add Protocol + Method/Tool columns |
| `src/scenarios/01-google-drive-obo.json` | Remove `branchId`; split MCP step |
| `src/scenarios/02-wrong-audience.json` | Remove `branchId` |
| `src/scenarios/03-workday-policy-deny.json` | Remove `branchId`; split MCP step |
| `src/scenarios/04-direct-vs-gateway-mcp.json` | Remove `branchId`; split MCP steps |
| `src/scenarios/05-agent-to-agent-direct-vs-gateway.json` | Remove `branchId`; split MCP step |
| `src/test/simulate.test.ts` | Update assertions that reference `branchId` or step counts |

## Out of Scope

- `iamAction` field — IAM AssumeRole verification is transparent/implicit
- `expectedOutcome` field — not needed for current educational goals
- Polymorphic step types (discriminated union) — overkill for a simulator
