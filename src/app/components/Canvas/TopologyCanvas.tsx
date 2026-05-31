import {
  Background,
  ConnectionMode,
  ConnectionLineType,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeMouseHandler,
  type HandleType,
  type NodeChange,
  type NodeProps,
  type NodeMouseHandler,
  type OnReconnect,
  useReactFlow
} from "@xyflow/react";
import { useMemo, useCallback, useEffect, useState, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import type { AuthMode } from "../../../model/auth";
import { EDGE_LABELS, legalEdgeKinds, type EdgeKind, isLegalEdge, isControlPlaneEdgeKind, type ScenarioEdge } from "../../../model/edges";
import type { AgentCoreIdentityNode, LocalPolicy, PolicyEngineNode } from "../../../model/nodes";
import { flowEdgesFromScenario, flowNodesFromScenario, useAppStore } from "../../store";
import { skeletonNode } from "../Palette/Palette";

const edgeKinds = Object.keys(EDGE_LABELS) as EdgeKind[];
const authModes: AuthMode[] = ["OAUTH_JWT", "AWS_IAM_SIGV4", "NONE"];
const authModeLabels: Record<AuthMode, string> = {
  OAUTH_JWT: "OAuth/JWT bearer token",
  AWS_IAM_SIGV4: "AWS IAM SigV4",
  NONE: "No auth"
};
const forwardedJwtHeaders = ["X-AgentCore-Inbound-OAuth-Token", "X-AgentCore-Forwarded-OAuth-Token", "X-Forwarded-Authorization"];
const NODE_WIDTH = 170;

interface ConnectionDraft {
  mode: "create" | "edit";
  edgeId?: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  authMode: AuthMode;
  credentialProviderName?: string;
  forwardInboundJwt: boolean;
  forwardedOAuthTokenHeader?: string;
  invalid: boolean;
  invalidReason?: string;
  editorPosition: { x: number; y: number };
}

interface GatewayPolicyDocument {
  schemaVersion: "agentcore-gateway-policy/v1";
  engineId: string;
  mode: "LOG_ONLY" | "ENFORCE";
  target: "agentcore_gateway";
  statements: Array<{
    sid: string;
    effect: "Allow" | "Deny";
    principal: "*" | { workloadIdentity: string };
    action: string;
    resource?: string;
    condition?: { expression: string };
  }>;
}

interface PolicyDraft {
  nodeId: string;
  json: string;
  error?: string;
}

interface DragPreview {
  sourceId: string;
  sourceHandle: "out" | "control";
  x: number;
  y: number;
  targetId?: string;
}

interface ReconnectDraft {
  edgeId: string;
  end: "source" | "target";
  edgeKind: EdgeKind;
  fixedNodeId: string;
  movingNodeId?: string;
  x: number;
  y: number;
}

type ReconnectStartHandler = (event: ReactMouseEvent, edge: Edge, handleType: HandleType) => void;
type ReconnectEndHandler = (event: globalThis.MouseEvent | TouchEvent, edge: Edge, handleType: HandleType) => void;

const nodeTheme: Record<string, { color: string; bg: string; label: string }> = {
  user: { color: "#62d18f", bg: "rgba(98, 209, 143, 0.10)", label: "User" },
  client_app: { color: "#7aa8ff", bg: "rgba(122, 168, 255, 0.10)", label: "Client" },
  external_genai_agent: { color: "#ffd166", bg: "rgba(255, 209, 102, 0.10)", label: "Ext Agent" },
  authorization_server: { color: "#b892ff", bg: "rgba(184, 146, 255, 0.10)", label: "AS" },
  agentcore_runtime_agent: { color: "#f4b454", bg: "rgba(244, 180, 84, 0.11)", label: "Runtime" },
  agentcore_gateway: { color: "#39c5bb", bg: "rgba(57, 197, 187, 0.12)", label: "Gateway" },
  agentcore_identity: { color: "#5eead4", bg: "rgba(94, 234, 212, 0.10)", label: "Identity" },
  policy_engine: { color: "#ff6b6b", bg: "rgba(255, 107, 107, 0.10)", label: "Policy" },
  agentcore_mcp_server: { color: "#a3e635", bg: "rgba(163, 230, 53, 0.10)", label: "MCP" },
  external_mcp_server: { color: "#fb923c", bg: "rgba(251, 146, 60, 0.10)", label: "External MCP" },
  external_api: { color: "#38bdf8", bg: "rgba(56, 189, 248, 0.10)", label: "API" },
  saas_resource: { color: "#f472b6", bg: "rgba(244, 114, 182, 0.10)", label: "SaaS" }
};

function MissionNode({ id, data, isConnectable }: NodeProps) {
  const label = String(data.label ?? "");
  const [title, type] = label.split("\n");
  const assetType = String(data.assetType ?? type);
  const activeOut = Boolean(data.activeOut);
  const suggestedTarget = Boolean(data.suggestedTarget);
  const connectionArmed = Boolean(data.connectionArmed);
  const controlArmed = Boolean(data.controlArmed);
  const sourceEndpoint = Boolean(data.sourceEndpoint);
  const targetEndpoint = Boolean(data.targetEndpoint);
  const controlEndpoint = Boolean(data.controlEndpoint);
  const theme = nodeTheme[assetType] ?? { color: "#39c5bb", bg: "rgba(57, 197, 187, 0.10)", label: type };
  const style = { "--asset-color": theme.color, "--asset-bg": theme.bg } as CSSProperties;
  return (
    <div className="agentcore-node-card relative w-[170px] px-3 py-2 shadow-lg" style={style}>
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className={`agentcore-handle agentcore-handle-in ${suggestedTarget ? "agentcore-handle-target-candidate" : ""} ${connectionArmed ? "agentcore-handle-target-ready" : ""} ${targetEndpoint ? "agentcore-handle-edge-endpoint" : ""}`}
        data-nodeid={id}
        data-handleid="in"
      />
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className={`agentcore-handle agentcore-handle-out ${activeOut ? "agentcore-handle-active-source" : ""} ${sourceEndpoint ? "agentcore-handle-edge-endpoint" : ""}`}
        data-nodeid={id}
        data-handleid="out"
      />
      <Handle
        id="control"
        type="source"
        position={Position.Bottom}
        isConnectable={isConnectable}
        className={`agentcore-handle agentcore-handle-control ${controlArmed ? "agentcore-handle-control-ready" : ""} ${controlEndpoint ? "agentcore-handle-edge-endpoint" : ""}`}
        data-nodeid={id}
        data-handleid="control"
      />
      <div className="agentcore-node-accent" />
      <div className="truncate text-[12px] font-semibold text-console-text">{title}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="truncate font-mono text-[10px] uppercase tracking-[0.08em] text-console-muted">{type}</div>
        <div className="agentcore-node-chip">{theme.label}</div>
      </div>
    </div>
  );
}

const nodeTypes = { mission: MissionNode };

function needsAuthMode(kind: EdgeKind): boolean {
  return (
    kind.includes("runtime") ||
    kind.includes("gateway") ||
    kind.includes("authorization_server") ||
    kind.includes("mcp") ||
    kind.includes("external_api") ||
    kind === "client_to_external_api"
  );
}

function authModesForConnection(kind: EdgeKind, sourceType?: string, targetType?: string): AuthMode[] {
  if (!needsAuthMode(kind)) return ["NONE"];
  if (kind.includes("authorization_server") || kind === "client_to_idp" || isProviderEdge(kind)) return ["OAUTH_JWT", "NONE"];
  if (targetType === "external_mcp_server" || targetType === "external_api") return ["OAUTH_JWT", "NONE"];
  if (sourceType === "agentcore_gateway" || targetType === "agentcore_gateway" || targetType === "agentcore_runtime_agent" || targetType === "agentcore_mcp_server") {
    return authModes;
  }
  return ["OAUTH_JWT", "NONE"];
}

function identityNodeFromConnection(scenario: ReturnType<typeof useAppStore.getState>["scenario"], sourceId: string, targetId: string): AgentCoreIdentityNode | undefined {
  const source = scenario.nodes.find((node) => node.id === sourceId);
  const target = scenario.nodes.find((node) => node.id === targetId);
  const identity = source?.type === "agentcore_identity" ? source : target?.type === "agentcore_identity" ? target : undefined;
  return identity as AgentCoreIdentityNode | undefined;
}

function providerNames(identity?: AgentCoreIdentityNode): string[] {
  return (identity?.credentialProviders ?? []).map((provider) => provider.name);
}

function providerFlow(identity: AgentCoreIdentityNode | undefined, providerName?: string): ScenarioEdge["credentialProviderFlow"] {
  if (!providerName || !identity) return undefined;
  return identity.credentialProviders.find((provider) => provider.name === providerName)?.flow;
}

function isProviderEdge(kind: EdgeKind): boolean {
  return kind === "identity_to_authorization_server" || kind === "authorization_server_to_identity";
}

function isAuthorizationServerIntegration(kind: EdgeKind): boolean {
  return kind === "runtime_to_authorization_server" || kind === "gateway_to_authorization_server_interceptor";
}

function supportsForwardedInboundJwt(kind: EdgeKind): boolean {
  return (
    kind === "runtime_to_gateway_mcp" ||
    kind === "gateway_to_http_runtime_target" ||
    kind === "runtime_to_runtime_http" ||
    kind === "runtime_to_runtime_a2a" ||
    kind === "client_to_gateway_mcp" ||
    kind === "external_agent_to_gateway_mcp" ||
    kind === "external_agent_to_runtime_http" ||
    kind === "external_agent_to_runtime_a2a" ||
    kind === "external_agent_to_mcp_direct"
  );
}

function handleForControlCandidate(sourceHandle: "out" | "control"): "in" | "control" {
  return sourceHandle === "control" ? "control" : "in";
}

function legalKindsForHandlePair(sourceType: string, targetType: string, sourceHandle: "out" | "control"): EdgeKind[] {
  const legal = legalEdgeKinds(sourceType, targetType);
  return legal.filter((kind) => isControlPlaneEdgeKind(kind) === (sourceHandle === "control"));
}

function invalidHandlePairReason(sourceType: string, targetType: string, sourceHandle: "out" | "control"): string {
  return sourceHandle === "control"
    ? `Use the bottom control port only for IdP/AS, Identity and PDP/PEP relationships. ${sourceType} -> ${targetType} has no control-plane relation.`
    : `Use the bottom control port for IdP/AS, Identity and PDP/PEP relationships. ${sourceType} -> ${targetType} is not a data-plane call.`;
}

function policyDocumentFromNode(policyEngine: PolicyEngineNode): GatewayPolicyDocument {
  return {
    schemaVersion: "agentcore-gateway-policy/v1",
    engineId: policyEngine.id,
    mode: policyEngine.mode,
    target: "agentcore_gateway",
    statements: policyEngine.policies.map((policy) => ({
      sid: policy.id,
      effect: policy.effect === "allow" ? "Allow" : "Deny",
      principal: policy.principal === "*" ? "*" : { workloadIdentity: policy.principal },
      action: policy.action,
      resource: policy.resource,
      condition: policy.condition ? { expression: policy.condition } : undefined
    }))
  };
}

function policiesFromDocument(input: unknown): { mode: "LOG_ONLY" | "ENFORCE"; policies: LocalPolicy[] } {
  if (!input || typeof input !== "object") throw new Error("Policy document must be a JSON object.");
  const doc = input as Partial<GatewayPolicyDocument>;
  if (doc.schemaVersion !== "agentcore-gateway-policy/v1") throw new Error("schemaVersion must be agentcore-gateway-policy/v1.");
  if (doc.mode !== "LOG_ONLY" && doc.mode !== "ENFORCE") throw new Error("mode must be LOG_ONLY or ENFORCE.");
  if (!Array.isArray(doc.statements)) throw new Error("statements must be an array.");
  const policies = doc.statements.map((statement, index) => {
    if (!statement || typeof statement !== "object") throw new Error(`statement ${index + 1} must be an object.`);
    if (statement.effect !== "Allow" && statement.effect !== "Deny") throw new Error(`statement ${index + 1} effect must be Allow or Deny.`);
    if (!statement.sid || !statement.action) throw new Error(`statement ${index + 1} requires sid and action.`);
    const principal = statement.principal === "*" ? "*" : statement.principal?.workloadIdentity;
    if (!principal) throw new Error(`statement ${index + 1} principal must be "*" or { "workloadIdentity": "..." }.`);
    const expression = statement.condition?.expression;
    return {
      id: statement.sid,
      effect: statement.effect === "Allow" ? "allow" : "deny",
      principal,
      action: statement.action,
      resource: statement.resource,
      condition: expression?.trim() ? expression : undefined
    } satisfies LocalPolicy;
  });
  return { mode: doc.mode, policies };
}

function invalidReasonFor(kind: EdgeKind, sourceType?: string, targetType?: string): string | undefined {
  if (!sourceType || !targetType) return "Invalid topology: missing source or target node.";
  if (isLegalEdge(kind, sourceType, targetType)) return undefined;
  return `Invalid topology: ${sourceType} cannot use ${kind} to reach ${targetType}.`;
}

function connectionNodeFromPoint(clientX: number, clientY: number, expectedHandle: "in" | "out" | "control", excludedNodeId?: string): string | undefined {
  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const handle = element?.closest(".agentcore-handle") as HTMLElement | null;
  if (handle?.getAttribute("data-handleid") === expectedHandle) {
    const nodeId = handle.getAttribute("data-nodeid") ?? undefined;
    if (nodeId && nodeId !== excludedNodeId) return nodeId;
  }
  const candidates = [...document.querySelectorAll<HTMLElement>(`.agentcore-handle[data-handleid="${expectedHandle}"]`)]
    .map((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(clientX - cx, clientY - cy);
      return { candidate, distance };
    })
    .filter(({ candidate, distance }) => candidate.getAttribute("data-nodeid") !== excludedNodeId && distance <= 42)
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.candidate.getAttribute("data-nodeid") ?? undefined;
}

function editorPositionNear(clientX?: number, clientY?: number): { x: number; y: number } {
  const width = 330;
  const height = 390;
  const margin = 16;
  const sourceX = clientX ?? window.innerWidth - width - margin;
  const sourceY = clientY ?? 72;
  const preferRight = sourceX + 24 + width <= window.innerWidth - margin;
  const x = preferRight ? sourceX + 24 : sourceX - width - 24;
  const y = sourceY - 36;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin))
  };
}

function EdgeOverlay({
  activePathEdgeIds,
  plannedPathEdgeIds,
  interactionsDisabled,
  onEditEdge
}: {
  activePathEdgeIds: Set<string>;
  plannedPathEdgeIds: Set<string>;
  interactionsDisabled: boolean;
  onEditEdge: (edgeId: string, event?: ReactMouseEvent | MouseEvent) => void;
}) {
  const { scenario } = useAppStore();
  const nodeById = new Map(scenario.nodes.map((node) => [node.id, node]));
  const parallelKeys = new Map<string, number>();
  return (
    <ViewportPortal>
      <svg className="agentcore-edge-overlay" style={{ position: "absolute", left: 0, top: 0, width: 1600, height: 900, overflow: "visible", pointerEvents: "none" }}>
        {scenario.edges.map((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;
          const parallelKey = `${edge.source}->${edge.target}`;
          const parallelIndex = parallelKeys.get(parallelKey) ?? 0;
          parallelKeys.set(parallelKey, parallelIndex + 1);
          const parallelOffset = parallelIndex * 18;
          const sourceX = source.position?.x ?? 0;
          const targetX = target.position?.x ?? 0;
          const controlPlane = isControlPlaneEdgeKind(edge.kind);
          const leftToRight = sourceX <= targetX;
          const sx = controlPlane ? sourceX + NODE_WIDTH / 2 : leftToRight ? sourceX + NODE_WIDTH : sourceX;
          const sy = (source.position?.y ?? 0) + (controlPlane ? 70 + parallelOffset : 31 + parallelOffset);
          const tx = controlPlane ? targetX + NODE_WIDTH / 2 : leftToRight ? targetX : targetX + NODE_WIDTH;
          const ty = (target.position?.y ?? 0) + (controlPlane ? 70 + parallelOffset : 31 + parallelOffset);
          const mid = Math.max(40, Math.abs(tx - sx) / 2);
          const controlDepth = Math.max(54, Math.min(120, Math.abs(tx - sx) * 0.18 + 54));
          const path = controlPlane
            ? `M ${sx} ${sy} C ${sx} ${sy + controlDepth}, ${tx} ${ty + controlDepth}, ${tx} ${ty}`
            : leftToRight ? `M ${sx} ${sy} C ${sx + mid} ${sy}, ${tx - mid} ${ty}, ${tx} ${ty}` : `M ${sx} ${sy} C ${sx - mid} ${sy}, ${tx + mid} ${ty}, ${tx} ${ty}`;
          const active = activePathEdgeIds.has(edge.id);
          const planned = plannedPathEdgeIds.has(edge.id);
          const color = edge.invalid ? "#ff4d4d" : active ? "#ffffff" : edge.authMode === "AWS_IAM_SIGV4" ? "#f4b454" : isProviderEdge(edge.kind) || isAuthorizationServerIntegration(edge.kind) ? "#b892ff" : edge.kind.includes("direct") ? "#ff6b6b" : "#39c5bb";
          return (
            <g key={edge.id}>
              <path data-edgeid={edge.id} d={path} fill="none" stroke="transparent" strokeWidth={20} style={{ pointerEvents: interactionsDisabled ? "none" : "stroke", cursor: "pointer" }} onClick={(event) => { event.stopPropagation(); onEditEdge(edge.id, event); }} />
              {planned && !active ? <path d={path} fill="none" stroke="rgba(122,168,255,0.24)" strokeWidth={8} opacity={0.9} style={{ pointerEvents: "none", filter: "drop-shadow(0 0 8px rgba(122,168,255,0.28))" }} /> : null}
              {active ? <path d={path} fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth={10} opacity={0.9} style={{ pointerEvents: "none", filter: "drop-shadow(0 0 10px rgba(255,255,255,0.35))" }} /> : null}
              <path d={path} fill="none" stroke={color} strokeWidth={edge.invalid ? 3 : active || planned ? 3 : 2} strokeDasharray={edge.invalid || edge.kind.includes("direct") ? "7 5" : undefined} opacity={active || planned ? 1 : 0.92} style={{ pointerEvents: "none" }} />
              {active ? <circle cx={(sx + tx) / 2} cy={(sy + ty) / 2} r={5} fill="#ffffff" stroke="#080b10" strokeWidth={2} style={{ pointerEvents: "none" }} /> : null}
              {edge.invalid ? <circle cx={(sx + tx) / 2} cy={(sy + ty) / 2} r={6} fill="#ff4d4d" stroke="#090d14" strokeWidth={2} style={{ pointerEvents: "none" }} /> : null}
              {isProviderEdge(edge.kind) || isAuthorizationServerIntegration(edge.kind) ? <circle cx={(sx + tx) / 2} cy={(sy + ty) / 2} r={4} fill={color} style={{ pointerEvents: "none" }} /> : null}
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

function ConnectionPreview({ preview, scenario }: { preview: DragPreview; scenario: ReturnType<typeof useAppStore.getState>["scenario"] }) {
  const source = scenario.nodes.find((node) => node.id === preview.sourceId);
  if (!source) return null;
  const controlPlane = preview.sourceHandle === "control";
  const sx = (source.position?.x ?? 0) + (controlPlane ? NODE_WIDTH / 2 : NODE_WIDTH);
  const sy = (source.position?.y ?? 0) + (controlPlane ? 70 : 31);
  const tx = preview.x;
  const ty = preview.y;
  const mid = Math.max(72, Math.abs(tx - sx) * 0.5);
  const path = controlPlane ? `M ${sx} ${sy} C ${sx} ${sy + 78}, ${tx} ${ty + 78}, ${tx} ${ty}` : `M ${sx} ${sy} C ${sx + mid} ${sy}, ${tx - mid} ${ty}, ${tx} ${ty}`;
  return (
    <ViewportPortal>
      <svg className="agentcore-connection-preview" style={{ position: "absolute", left: 0, top: 0, width: 1600, height: 900, overflow: "visible", pointerEvents: "none" }}>
        <path className="agentcore-preview-path agentcore-preview-path-glow" d={path} fill="none" />
        <path className="agentcore-preview-path" d={path} fill="none" />
        <circle className={`agentcore-preview-end ${preview.targetId ? "agentcore-preview-end-valid" : ""}`} cx={tx} cy={ty} r={preview.targetId ? 8 : 6} />
        <text className="agentcore-preview-label" x={tx + 12} y={ty - 12}>{preview.targetId ? "release to configure" : controlPlane ? "drag to a control circle" : "drag to an input circle"}</text>
      </svg>
    </ViewportPortal>
  );
}

function ReconnectPreview({ draft, scenario }: { draft: ReconnectDraft; scenario: ReturnType<typeof useAppStore.getState>["scenario"] }) {
  const fixed = scenario.nodes.find((node) => node.id === draft.fixedNodeId);
  if (!fixed) return null;
  const controlPlane = isControlPlaneEdgeKind(draft.edgeKind);
  const fixedX = controlPlane ? (fixed.position?.x ?? 0) + NODE_WIDTH / 2 : draft.end === "target" ? (fixed.position?.x ?? 0) + NODE_WIDTH : fixed.position?.x ?? 0;
  const fixedY = (fixed.position?.y ?? 0) + (controlPlane ? 70 : 31);
  const sx = draft.end === "target" ? fixedX : draft.x;
  const sy = draft.end === "target" ? fixedY : draft.y;
  const tx = draft.end === "target" ? draft.x : fixedX;
  const ty = draft.end === "target" ? draft.y : fixedY;
  const mid = Math.max(72, Math.abs(tx - sx) * 0.5);
  const path = controlPlane ? `M ${sx} ${sy} C ${sx} ${sy + 78}, ${tx} ${ty + 78}, ${tx} ${ty}` : sx <= tx ? `M ${sx} ${sy} C ${sx + mid} ${sy}, ${tx - mid} ${ty}, ${tx} ${ty}` : `M ${sx} ${sy} C ${sx - mid} ${sy}, ${tx + mid} ${ty}, ${tx} ${ty}`;
  return (
    <ViewportPortal>
      <svg className="agentcore-connection-preview" style={{ position: "absolute", left: 0, top: 0, width: 1600, height: 900, overflow: "visible", pointerEvents: "none" }}>
        <path className="agentcore-preview-path agentcore-preview-path-glow" d={path} fill="none" />
        <path className="agentcore-preview-path agentcore-preview-path-reconnect" d={path} fill="none" />
        <circle className={`agentcore-preview-end ${draft.movingNodeId ? "agentcore-preview-end-valid" : ""}`} cx={draft.x} cy={draft.y} r={draft.movingNodeId ? 8 : 6} />
        <text className="agentcore-preview-label" x={draft.x + 12} y={draft.y - 12}>{draft.movingNodeId ? "release to move endpoint" : controlPlane ? "drag to a control circle" : `drag to ${draft.end === "source" ? "an output" : "an input"} circle`}</text>
      </svg>
    </ViewportPortal>
  );
}

function ConnectionEditor({
  draft,
  scenario,
  onCancel,
  onChange,
  onDelete,
  onSave
}: {
  draft: ConnectionDraft;
  scenario: ReturnType<typeof useAppStore.getState>["scenario"];
  onCancel: () => void;
  onChange: (draft: ConnectionDraft) => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const source = scenario.nodes.find((node) => node.id === draft.sourceId);
  const target = scenario.nodes.find((node) => node.id === draft.targetId);
  const legalKinds = source && target ? legalKindsForHandlePair(source.type, target.type, isControlPlaneEdgeKind(draft.kind) ? "control" : "out") : [];
  const selectableKinds = legalKinds.length ? legalKinds : edgeKinds;
  const identity = identityNodeFromConnection(scenario, draft.sourceId, draft.targetId);
  const providers = providerNames(identity);
  const provider = draft.credentialProviderName ?? providers[0];
  const availableAuthModes = authModesForConnection(draft.kind, source?.type, target?.type);
  return (
    <div
      data-testid="connection-editor"
      className="fixed z-40 w-[330px] border border-console-cyan/50 bg-console-panel shadow-2xl"
      style={{ left: draft.editorPosition.x, top: draft.editorPosition.y }}
    >
      <div className="border-b border-console-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-console-muted">
        {draft.mode === "edit" ? "Edit Connection" : "Create Connection"}
      </div>
      <div className="space-y-3 p-3 text-xs">
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-console-muted">
          <div className="truncate border border-console-line bg-console-rail p-2">{source?.displayName ?? draft.sourceId}</div>
          <div className="truncate border border-console-line bg-console-rail p-2">{target?.displayName ?? draft.targetId}</div>
        </div>
        {draft.invalid ? (
          <div className="border border-console-red/60 bg-console-red/10 p-2 text-[11px] text-console-red">
            {draft.invalidReason}
          </div>
        ) : null}
        <label className="block">
          <span className="field-label">Connection Type</span>
          <select
            data-testid="connection-kind-select"
            className="mt-1 w-full border border-console-line bg-console-panel2 p-2 font-mono text-console-text"
            value={draft.kind}
            onChange={(event) => {
              const kind = event.target.value as EdgeKind;
              const nextProvider = isProviderEdge(kind) ? provider : undefined;
              const valid = Boolean(source && target && isLegalEdge(kind, source.type, target.type));
              const nextAuthModes = authModesForConnection(kind, source?.type, target?.type);
              const nextAuthMode = nextAuthModes.includes(draft.authMode) ? draft.authMode : nextAuthModes[0];
              const canForwardJwt = nextAuthMode === "AWS_IAM_SIGV4" && supportsForwardedInboundJwt(kind);
              onChange({
                ...draft,
                kind,
                authMode: needsAuthMode(kind) ? nextAuthMode : "NONE",
                credentialProviderName: nextProvider,
                forwardInboundJwt: canForwardJwt ? draft.forwardInboundJwt : false,
                forwardedOAuthTokenHeader: canForwardJwt && draft.forwardInboundJwt ? draft.forwardedOAuthTokenHeader ?? forwardedJwtHeaders[0] : undefined,
                invalid: !valid,
                invalidReason: valid ? undefined : `Invalid topology: ${source?.type ?? draft.sourceId} cannot use ${kind} to reach ${target?.type ?? draft.targetId}.`
              });
            }}
          >
            {selectableKinds.map((kind) => (
              <option key={kind} value={kind}>{`${EDGE_LABELS[kind]} (${kind})`}</option>
            ))}
          </select>
        </label>
        {needsAuthMode(draft.kind) ? (
          <label className="block">
            <span className="field-label">Auth Mode</span>
            <select
              data-testid="connection-auth-select"
              className="mt-1 w-full border border-console-line bg-console-panel2 p-2 font-mono text-console-text"
              value={draft.authMode}
              onChange={(event) => {
                const authMode = event.target.value as AuthMode;
                onChange({
                  ...draft,
                  authMode,
                  forwardInboundJwt: authMode === "AWS_IAM_SIGV4" && supportsForwardedInboundJwt(draft.kind) ? draft.forwardInboundJwt : false,
                  forwardedOAuthTokenHeader: authMode === "AWS_IAM_SIGV4" && supportsForwardedInboundJwt(draft.kind) ? draft.forwardedOAuthTokenHeader ?? forwardedJwtHeaders[0] : undefined
                });
              }}
            >
              {availableAuthModes.map((mode) => (
                <option key={mode} value={mode}>{authModeLabels[mode]}</option>
              ))}
            </select>
          </label>
        ) : null}
        {draft.authMode === "AWS_IAM_SIGV4" && supportsForwardedInboundJwt(draft.kind) ? (
          <div className="space-y-2 border border-console-line bg-console-rail p-2">
            <label className="flex items-start gap-2 text-[11px] text-console-text">
              <input
                data-testid="connection-forward-jwt-toggle"
                type="checkbox"
                className="mt-0.5"
                checked={draft.forwardInboundJwt}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    forwardInboundJwt: event.target.checked,
                    forwardedOAuthTokenHeader: event.target.checked ? draft.forwardedOAuthTokenHeader ?? forwardedJwtHeaders[0] : undefined
                  })
                }
              />
              <span>Send inbound OAuth/JWT as custom context header</span>
            </label>
            {draft.forwardInboundJwt ? (
              <label className="block">
                <span className="field-label">Custom Header</span>
                <select
                  data-testid="connection-forward-jwt-header-select"
                  className="mt-1 w-full border border-console-line bg-console-panel2 p-2 font-mono text-console-text"
                  value={draft.forwardedOAuthTokenHeader ?? forwardedJwtHeaders[0]}
                  onChange={(event) => onChange({ ...draft, forwardedOAuthTokenHeader: event.target.value })}
                >
                  {forwardedJwtHeaders.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        {isProviderEdge(draft.kind) ? (
          <label className="block">
            <span className="field-label">Credential Provider</span>
            <select
              data-testid="connection-provider-select"
              className="mt-1 w-full border border-console-line bg-console-panel2 p-2 font-mono text-console-text"
              value={provider ?? ""}
              onChange={(event) => onChange({ ...draft, credentialProviderName: event.target.value })}
            >
              {providers.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="rounded-[4px] border border-console-line bg-console-rail p-2 text-[11px] text-console-muted">
          {isProviderEdge(draft.kind)
            ? "This edge models one Identity credential provider relationship with the Keycloak authorization server."
            : draft.kind === "runtime_to_authorization_server"
              ? "This edge models custom runtime code acting as an OAuth/OIDC client against the authorization server. It is separate from AgentCore Identity provider mediation."
              : draft.kind === "gateway_to_authorization_server_interceptor"
                ? "This edge models a Gateway Lambda request interceptor reaching the authorization server for token introspection, exchange or validation before target routing."
                : draft.authMode === "AWS_IAM_SIGV4" && draft.forwardInboundJwt
                  ? "SigV4 authenticates the AWS caller. The custom header carries the original inbound JWT only as user context and must be validated/redacted by the receiver."
            : "The selected edge type determines the simulation steps, protocol, request headers and security verdicts."}
        </div>
        <div className="flex justify-end gap-2">
          {draft.mode === "edit" ? (
            <button data-testid="connection-delete" className="mr-auto border border-console-red/70 bg-console-red/10 px-3 py-2 text-console-red hover:bg-console-red/20" onClick={onDelete}>
              Delete
            </button>
          ) : null}
          <button data-testid="connection-cancel" className="border border-console-line bg-console-panel2 px-3 py-2 text-console-muted hover:border-console-cyan" onClick={onCancel}>Cancel</button>
          <button data-testid="connection-apply" className="bg-console-cyan px-3 py-2 font-semibold text-console-bg hover:bg-console-green" onClick={onSave}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function PolicyEditor({
  draft,
  onCancel,
  onChange,
  onSave
}: {
  draft: PolicyDraft;
  onCancel: () => void;
  onChange: (json: string) => void;
  onSave: () => void;
}) {
  return (
    <div data-testid="policy-editor" className="absolute left-1/2 top-8 z-30 flex max-h-[78%] w-[620px] -translate-x-1/2 flex-col border border-console-red/60 bg-console-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-console-line px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-console-muted">
        <span className="font-semibold">AgentCore Gateway Policy</span>
        <span className="font-mono">{draft.nodeId}</span>
      </div>
      <div className="space-y-3 p-3 text-xs">
        <div className="border border-console-line bg-console-rail p-2 text-[11px] text-console-muted">
          Double click a Policy Engine to edit a Gateway-compatible policy document. Conditions use the simulator DSL: principal/context/arguments, comparisons, boolean operators and includes(...).
        </div>
        <textarea
          data-testid="policy-json-editor"
          className="h-[360px] w-full resize-none border border-console-line bg-console-bg p-3 font-mono text-[11px] leading-5 text-console-text outline-none focus:border-console-red"
          spellCheck={false}
          value={draft.json}
          onChange={(event) => onChange(event.target.value)}
        />
        {draft.error ? <div className="border border-console-red/60 bg-console-red/10 p-2 text-console-red">{draft.error}</div> : null}
        <div className="flex justify-end gap-2">
          <button data-testid="policy-cancel" className="border border-console-line bg-console-panel2 px-3 py-2 text-console-muted hover:border-console-red" onClick={onCancel}>Cancel</button>
          <button data-testid="policy-apply" className="bg-console-red px-3 py-2 font-semibold text-white hover:bg-console-amber" onClick={onSave}>Apply Policy</button>
        </div>
      </div>
    </div>
  );
}

function CanvasInner() {
  const { scenario, result, selectedEventId, updateNodes, addNode, updateNode, addEdge, updateEdge, deleteEdge } = useAppStore();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [pendingSourceNodeId, setPendingSourceNodeId] = useState<string | undefined>();
  const [pendingSourceHandle, setPendingSourceHandle] = useState<"out" | "control" | undefined>();
  const [dragSourceNodeId, setDragSourceNodeId] = useState<string | undefined>();
  const [dragPreview, setDragPreview] = useState<DragPreview | undefined>();
  const [reconnectDraft, setReconnectDraft] = useState<ReconnectDraft | undefined>();
  const [reconnecting, setReconnecting] = useState<{ edgeId: string; handleType: HandleType } | undefined>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | undefined>();
  const [draft, setDraft] = useState<ConnectionDraft | undefined>();
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const nodes = useMemo(() => {
    const armed = Boolean(pendingSourceNodeId || dragSourceNodeId || reconnecting || reconnectDraft);
    const selectedEdge = selectedEdgeId ? scenario.edges.find((edge) => edge.id === selectedEdgeId) : undefined;
    const selectedControlEdge = Boolean(selectedEdge && isControlPlaneEdgeKind(selectedEdge.kind));
    return flowNodesFromScenario(scenario).map((node) => ({
      ...node,
      data: {
        ...node.data,
        activeOut: !selectedControlEdge && ((node.id === pendingSourceNodeId && pendingSourceHandle === "out") || (dragSourceNodeId === node.id && dragPreview?.sourceHandle === "out") || ((!reconnectDraft || !isControlPlaneEdgeKind(reconnectDraft.edgeKind)) && reconnectDraft?.end === "source" && node.id === reconnectDraft.movingNodeId)),
        controlArmed: (node.id === pendingSourceNodeId && pendingSourceHandle === "control") || (dragSourceNodeId === node.id && dragPreview?.sourceHandle === "control") || (reconnectDraft && isControlPlaneEdgeKind(reconnectDraft.edgeKind) && reconnectDraft.movingNodeId === node.id),
        suggestedTarget: node.id === dragPreview?.targetId || node.id === reconnectDraft?.movingNodeId,
        connectionArmed: armed && node.id !== pendingSourceNodeId && node.id !== dragSourceNodeId,
        sourceEndpoint: !selectedControlEdge && selectedEdge?.source === node.id,
        targetEndpoint: !selectedControlEdge && selectedEdge?.target === node.id,
        controlEndpoint: selectedControlEdge && (selectedEdge?.source === node.id || selectedEdge?.target === node.id)
      }
    }));
  }, [dragPreview?.sourceHandle, dragPreview?.targetId, dragSourceNodeId, pendingSourceHandle, pendingSourceNodeId, reconnectDraft, reconnecting, scenario, selectedEdgeId]);
  const edges = useMemo(() => flowEdgesFromScenario(scenario), [scenario]);
  const activePathEdgeIds = useMemo(() => {
    const selectedEvent = result?.events.find((event) => event.id === selectedEventId) ?? result?.events[0];
    const activeEvents = result?.events.filter((event) => selectedEvent && event.index <= selectedEvent.index) ?? [];
    const ids = new Set<string>();
    for (const event of activeEvents) {
      for (const edge of scenario.edges) {
        if (edge.source === event.sourceNodeId && edge.target === event.targetNodeId) ids.add(edge.id);
      }
    }
    return ids;
  }, [result?.events, scenario.edges, selectedEventId]);
  const plannedPathEdgeIds = useMemo(() => new Set(scenario.selectedPath ?? []), [scenario.selectedPath]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void fitView({ padding: 0.16, duration: 0 });
    }, 40);
    return () => window.clearTimeout(handle);
  }, [fitView, scenario.id, scenario.nodes.length]);

  const openConnectionEditor = useCallback(
    (connection: Connection, mode: "create" | "edit" = "create", edgeId?: string, position?: { clientX?: number; clientY?: number }, sourceHandle?: "out" | "control") => {
      const source = scenario.nodes.find((node) => node.id === connection.source);
      const target = scenario.nodes.find((node) => node.id === connection.target);
      if (!source || !target || !connection.source || !connection.target) return;
      const existing = edgeId ? scenario.edges.find((edge) => edge.id === edgeId) : undefined;
      const handlePlane = sourceHandle ?? (existing && isControlPlaneEdgeKind(existing.kind) ? "control" : "out");
      const legalKinds = mode === "create" ? legalKindsForHandlePair(source.type, target.type, handlePlane) : legalEdgeKinds(source.type, target.type);
      const allLegalKinds = legalEdgeKinds(source.type, target.type);
      const kind = existing?.kind ?? legalKinds[0] ?? edgeKinds[0];
      const invalidReason = existing?.invalidReason ?? (legalKinds.length ? invalidReasonFor(kind, source.type, target.type) : allLegalKinds.length ? invalidHandlePairReason(source.type, target.type, handlePlane) : invalidReasonFor(kind, source.type, target.type));
      const identity = identityNodeFromConnection(scenario, connection.source, connection.target);
      const providers = providerNames(identity);
      const forwardsJwt = Boolean(existing?.forwardedOAuthTokenHeader && existing.authMode === "AWS_IAM_SIGV4" && supportsForwardedInboundJwt(kind));
      const availableAuthModes = authModesForConnection(kind, source.type, target.type);
      const authMode = existing?.authMode && availableAuthModes.includes(existing.authMode) ? existing.authMode : needsAuthMode(kind) ? availableAuthModes[0] : "NONE";
      setNotice(undefined);
      setDraft({
        mode,
        edgeId,
        sourceId: connection.source,
        targetId: connection.target,
        kind,
        authMode,
        credentialProviderName: existing?.credentialProviderName ?? (isProviderEdge(kind) ? providers[0] : undefined),
        forwardInboundJwt: forwardsJwt,
        forwardedOAuthTokenHeader: forwardsJwt ? existing?.forwardedOAuthTokenHeader : undefined,
        invalid: existing?.invalid ?? Boolean(invalidReason),
        invalidReason: invalidReason ?? undefined,
        editorPosition: editorPositionNear(position?.clientX, position?.clientY)
      });
    },
    [scenario.edges, scenario.nodes]
  );

  const onConnect = useCallback((connection: Connection) => openConnectionEditor(connection, "create", undefined, undefined, connection.sourceHandle === "control" ? "control" : "out"), [openConnectionEditor]);

  const onEditEdge = useCallback(
    (edgeId: string, event?: ReactMouseEvent | MouseEvent) => {
      const edge = scenario.edges.find((item) => item.id === edgeId);
      if (!edge) return;
      setSelectedEdgeId(edge.id);
      openConnectionEditor(
        { source: edge.source, target: edge.target, sourceHandle: isControlPlaneEdgeKind(edge.kind) ? "control" : "out", targetHandle: isControlPlaneEdgeKind(edge.kind) ? "control" : "in" },
        "edit",
        edge.id,
        { clientX: event?.clientX, clientY: event?.clientY },
        isControlPlaneEdgeKind(edge.kind) ? "control" : "out"
      );
    },
    [openConnectionEditor, scenario.edges]
  );

  const onNativeEdgeClick = useCallback<EdgeMouseHandler>(
    (event, edge) => {
      event.stopPropagation();
      onEditEdge(edge.id, event);
    },
    [onEditEdge]
  );

  const onReconnect = useCallback<OnReconnect<Edge>>(
    (oldEdge, newConnection) => {
      const existing = scenario.edges.find((edge) => edge.id === oldEdge.id);
      if (!existing || !newConnection.source || !newConnection.target) return;
      const source = scenario.nodes.find((node) => node.id === newConnection.source);
      const target = scenario.nodes.find((node) => node.id === newConnection.target);
      const valid = Boolean(source && target && isLegalEdge(existing.kind, source.type, target.type));
      const identity = identityNodeFromConnection(scenario, newConnection.source, newConnection.target);
      const credentialProviderName = isProviderEdge(existing.kind) ? existing.credentialProviderName ?? providerNames(identity)[0] : undefined;
      void updateEdge(existing.id, {
        source: newConnection.source,
        target: newConnection.target,
        credentialProviderName,
        credentialProviderFlow: providerFlow(identity, credentialProviderName),
        label: credentialProviderName ? `Provider: ${credentialProviderName}` : existing.label,
        invalid: !valid,
        invalidReason: valid ? undefined : invalidReasonFor(existing.kind, source?.type, target?.type)
      });
      setNotice(valid ? "Connection endpoint moved." : "Connection endpoint moved and marked invalid. Click the line to review it.");
      window.setTimeout(() => setNotice(undefined), 2400);
    },
    [scenario.edges, scenario.nodes, updateEdge]
  );

  const onReconnectStart = useCallback<ReconnectStartHandler>((_event, edge, handleType) => {
    setReconnecting({ edgeId: edge.id, handleType });
    setNotice(`Move the ${handleType} endpoint to another compatible circle.`);
  }, []);

  const onReconnectEnd = useCallback<ReconnectEndHandler>(() => {
    setReconnecting(undefined);
    window.setTimeout(() => setNotice(undefined), 1600);
  }, []);

  const finishOverlayReconnect = useCallback(
    (draftToApply: ReconnectDraft) => {
      const edge = scenario.edges.find((item) => item.id === draftToApply.edgeId);
      if (!edge || !draftToApply.movingNodeId) return false;
      const nextSource = draftToApply.end === "source" ? draftToApply.movingNodeId : edge.source;
      const nextTarget = draftToApply.end === "target" ? draftToApply.movingNodeId : edge.target;
      const source = scenario.nodes.find((node) => node.id === nextSource);
      const target = scenario.nodes.find((node) => node.id === nextTarget);
      const invalidReason = invalidReasonFor(edge.kind, source?.type, target?.type);
      const identity = identityNodeFromConnection(scenario, nextSource, nextTarget);
      const credentialProviderName = isProviderEdge(edge.kind) ? edge.credentialProviderName ?? providerNames(identity)[0] : undefined;
      void updateEdge(edge.id, {
        source: nextSource,
        target: nextTarget,
        credentialProviderName,
        credentialProviderFlow: providerFlow(identity, credentialProviderName),
        label: credentialProviderName ? `Provider: ${credentialProviderName}` : edge.label,
        invalid: Boolean(invalidReason),
        invalidReason
      });
      setDraft((current) =>
        current?.edgeId === edge.id
          ? { ...current, sourceId: nextSource, targetId: nextTarget, credentialProviderName, invalid: Boolean(invalidReason), invalidReason, editorPosition: editorPositionNear(draftToApply.x, draftToApply.y) }
          : current
      );
      setNotice(invalidReason ? "Endpoint moved and marked invalid. Click the line to review it." : "Endpoint moved.");
      setSelectedEdgeId(edge.id);
      window.setTimeout(() => setNotice(undefined), 2400);
      return true;
    },
    [scenario.edges, scenario.nodes, updateEdge]
  );

  const saveDraft = useCallback(() => {
    if (!draft) return;
    const source = scenario.nodes.find((node) => node.id === draft.sourceId);
    const target = scenario.nodes.find((node) => node.id === draft.targetId);
    if (!source || !target) return;
    const identity = identityNodeFromConnection(scenario, draft.sourceId, draft.targetId);
    const credentialProviderName = isProviderEdge(draft.kind) ? draft.credentialProviderName : undefined;
    const invalidReason = invalidReasonFor(draft.kind, source.type, target.type);
    const patch: Partial<ScenarioEdge> = {
      kind: draft.kind,
      label: credentialProviderName ? `Provider: ${credentialProviderName}` : EDGE_LABELS[draft.kind],
      authMode: needsAuthMode(draft.kind) ? draft.authMode : undefined,
      forwardedOAuthTokenHeader:
        draft.authMode === "AWS_IAM_SIGV4" && draft.forwardInboundJwt && supportsForwardedInboundJwt(draft.kind)
          ? draft.forwardedOAuthTokenHeader ?? forwardedJwtHeaders[0]
          : undefined,
      credentialProviderName,
      credentialProviderFlow: providerFlow(identity, credentialProviderName),
      invalid: Boolean(invalidReason),
      invalidReason: invalidReason ?? undefined
    };
    if (draft.mode === "edit" && draft.edgeId) {
      void updateEdge(draft.edgeId, patch);
      setSelectedEdgeId(draft.edgeId);
    } else {
      const id = `edge-${Date.now()}`;
      void addEdge({
        id,
        source: draft.sourceId,
        target: draft.targetId,
        kind: draft.kind,
        label: patch.label,
        authMode: patch.authMode,
        forwardedOAuthTokenHeader: patch.forwardedOAuthTokenHeader,
        credentialProviderName: patch.credentialProviderName,
        credentialProviderFlow: patch.credentialProviderFlow,
        invalid: patch.invalid,
        invalidReason: patch.invalidReason
      });
      setSelectedEdgeId(undefined);
    }
    setDraft(undefined);
    setPendingSourceNodeId(undefined);
    setPendingSourceHandle(undefined);
  }, [addEdge, draft, scenario.nodes, updateEdge]);

  const deleteDraft = useCallback(() => {
    if (draft?.mode === "edit" && draft.edgeId) {
      void deleteEdge(draft.edgeId);
      if (selectedEdgeId === draft.edgeId) setSelectedEdgeId(undefined);
    }
    setDraft(undefined);
    setPendingSourceNodeId(undefined);
    setPendingSourceHandle(undefined);
  }, [deleteEdge, draft, selectedEdgeId]);

  const cancelDraft = useCallback(() => {
    setDraft(undefined);
    setPendingSourceNodeId(undefined);
    setPendingSourceHandle(undefined);
    setDragSourceNodeId(undefined);
    setDragPreview(undefined);
  }, []);

  const openPolicyEditor = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const policyEngine = scenario.nodes.find((item) => item.id === node.id && item.type === "policy_engine") as PolicyEngineNode | undefined;
      if (!policyEngine) return;
      setPolicyDraft({ nodeId: policyEngine.id, json: JSON.stringify(policyDocumentFromNode(policyEngine), null, 2) });
    },
    [scenario.nodes]
  );

  const savePolicyDraft = useCallback(() => {
    if (!policyDraft) return;
    try {
      const parsed = JSON.parse(policyDraft.json) as unknown;
      const { mode, policies } = policiesFromDocument(parsed);
      void updateNode(policyDraft.nodeId, { mode, policies } as Partial<PolicyEngineNode>);
      setPolicyDraft(undefined);
    } catch (error) {
      setPolicyDraft({ ...policyDraft, error: error instanceof Error ? error.message : "Invalid policy document." });
    }
  }, [policyDraft, updateNode]);

  const onCanvasClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const handle = (event.target as HTMLElement).closest(".agentcore-handle") as HTMLElement | null;
      if (!handle) return;
      const nodeId = handle.getAttribute("data-nodeid") ?? undefined;
      const handleId = handle.getAttribute("data-handleid");
      if (!nodeId) return;
      const selectedEdge = selectedEdgeId ? scenario.edges.find((edge) => edge.id === selectedEdgeId) : undefined;
      const selectedControlEdge = Boolean(selectedEdge && isControlPlaneEdgeKind(selectedEdge.kind));
      if (
        (selectedControlEdge && (selectedEdge?.source === nodeId || selectedEdge?.target === nodeId) && handleId === "control") ||
        (!selectedControlEdge && ((selectedEdge?.source === nodeId && handleId === "out") || (selectedEdge?.target === nodeId && handleId === "in")))
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if ((handleId === "out" || handleId === "control") && (!pendingSourceNodeId || pendingSourceNodeId === nodeId)) {
        setPendingSourceNodeId(nodeId);
        setPendingSourceHandle(handleId);
        setDragPreview(undefined);
        setNotice(handleId === "control" ? "Control-plane connection started. Drag or click another bottom control circle." : "Connection started. Drag to a target circle or click a target circle to create the edge.");
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const expectedTargetHandle = handleForControlCandidate(pendingSourceHandle ?? "out");
      if (pendingSourceNodeId && handleId === expectedTargetHandle && pendingSourceNodeId !== nodeId) {
        openConnectionEditor({ source: pendingSourceNodeId, target: nodeId, sourceHandle: pendingSourceHandle ?? "out", targetHandle: expectedTargetHandle }, "create", undefined, { clientX: event.clientX, clientY: event.clientY }, pendingSourceHandle ?? "out");
        setPendingSourceNodeId(undefined);
        setPendingSourceHandle(undefined);
        setDragPreview(undefined);
        setNotice(undefined);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (pendingSourceNodeId && handleId !== expectedTargetHandle) {
        setNotice(expectedTargetHandle === "control" ? "Finish this relationship on a bottom control circle." : "Finish this call on a left input circle.");
        event.preventDefault();
        event.stopPropagation();
      }
    },
    [openConnectionEditor, pendingSourceHandle, pendingSourceNodeId, scenario.edges, selectedEdgeId]
  );

  const onCanvasMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const handle = (event.target as HTMLElement).closest(".agentcore-handle") as HTMLElement | null;
    if (!handle) return;
    const nodeId = handle.getAttribute("data-nodeid") ?? undefined;
    const handleId = handle.getAttribute("data-handleid") as "in" | "out" | "control" | null;
    if (!nodeId) return;
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const selectedEdge = selectedEdgeId ? scenario.edges.find((edge) => edge.id === selectedEdgeId) : undefined;
    const selectedControlEdge = Boolean(selectedEdge && isControlPlaneEdgeKind(selectedEdge.kind));
    if (selectedControlEdge && selectedEdge?.source === nodeId && handleId === "control") {
      setReconnectDraft({ edgeId: selectedEdge.id, edgeKind: selectedEdge.kind, end: "source", fixedNodeId: selectedEdge.target, x: point.x, y: point.y });
      setNotice("Move the source endpoint from this control circle to another control circle.");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (selectedControlEdge && selectedEdge?.target === nodeId && handleId === "control") {
      setReconnectDraft({ edgeId: selectedEdge.id, edgeKind: selectedEdge.kind, end: "target", fixedNodeId: selectedEdge.source, x: point.x, y: point.y });
      setNotice("Move the target endpoint from this control circle to another control circle.");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!selectedControlEdge && selectedEdge?.source === nodeId && handleId === "out") {
      setReconnectDraft({ edgeId: selectedEdge.id, edgeKind: selectedEdge.kind, end: "source", fixedNodeId: selectedEdge.target, x: point.x, y: point.y });
      setNotice("Move the source endpoint from this output circle to another output circle.");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!selectedControlEdge && selectedEdge?.target === nodeId && handleId === "in") {
      setReconnectDraft({ edgeId: selectedEdge.id, edgeKind: selectedEdge.kind, end: "target", fixedNodeId: selectedEdge.source, x: point.x, y: point.y });
      setNotice("Move the target endpoint from this input circle to another input circle.");
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (handleId !== "out" && handleId !== "control") return;
    setDragSourceNodeId(nodeId);
    setPendingSourceNodeId(undefined);
    setPendingSourceHandle(undefined);
    setDragPreview({ sourceId: nodeId, sourceHandle: handleId, x: point.x, y: point.y });
    setNotice(handleId === "control" ? "Release on another bottom control circle to configure the relationship." : "Release on a target circle to configure the edge.");
    event.preventDefault();
    event.stopPropagation();
  }, [scenario.edges, screenToFlowPosition, selectedEdgeId]);

  const onCanvasMouseMoveCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (reconnectDraft) {
        const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const expectedHandle = isControlPlaneEdgeKind(reconnectDraft.edgeKind) ? "control" : reconnectDraft.end === "source" ? "out" : "in";
        const movingNodeId = connectionNodeFromPoint(event.clientX, event.clientY, expectedHandle, reconnectDraft.fixedNodeId);
        setReconnectDraft({ ...reconnectDraft, x: point.x, y: point.y, movingNodeId });
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!dragSourceNodeId || !dragPreview) return;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const targetHandle = handleForControlCandidate(dragPreview.sourceHandle);
      setDragPreview({
        sourceId: dragSourceNodeId,
        sourceHandle: dragPreview.sourceHandle,
        x: point.x,
        y: point.y,
        targetId: connectionNodeFromPoint(event.clientX, event.clientY, targetHandle, dragSourceNodeId)
      });
      event.preventDefault();
      event.stopPropagation();
    },
    [dragPreview, dragSourceNodeId, reconnectDraft, screenToFlowPosition]
  );

  const onCanvasMouseUpCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (reconnectDraft) {
        const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const expectedHandle = isControlPlaneEdgeKind(reconnectDraft.edgeKind) ? "control" : reconnectDraft.end === "source" ? "out" : "in";
        const movingNodeId = connectionNodeFromPoint(event.clientX, event.clientY, expectedHandle, reconnectDraft.fixedNodeId);
        finishOverlayReconnect({ ...reconnectDraft, x: point.x, y: point.y, movingNodeId });
        setReconnectDraft(undefined);
        setPendingSourceNodeId(undefined);
        setPendingSourceHandle(undefined);
        setDragSourceNodeId(undefined);
        setDragPreview(undefined);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (dragSourceNodeId && dragPreview) {
        const targetHandle = handleForControlCandidate(dragPreview.sourceHandle);
        const targetNodeId = connectionNodeFromPoint(event.clientX, event.clientY, targetHandle, dragSourceNodeId);
        if (targetNodeId) {
          openConnectionEditor({ source: dragSourceNodeId, target: targetNodeId, sourceHandle: dragPreview.sourceHandle, targetHandle }, "create", undefined, { clientX: event.clientX, clientY: event.clientY }, dragPreview.sourceHandle);
          setPendingSourceNodeId(undefined);
          setPendingSourceHandle(undefined);
          setDragSourceNodeId(undefined);
          setDragPreview(undefined);
          setNotice(undefined);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      const handle = (event.target as HTMLElement).closest(".agentcore-handle") as HTMLElement | null;
      if (!handle) {
        setDragSourceNodeId(undefined);
        setDragPreview(undefined);
        return;
      }
      const targetNodeId = handle.getAttribute("data-nodeid") ?? undefined;
      const handleId = handle.getAttribute("data-handleid");
      if (dragSourceNodeId && dragPreview && targetNodeId && handleId === handleForControlCandidate(dragPreview.sourceHandle) && dragSourceNodeId !== targetNodeId) {
        openConnectionEditor({ source: dragSourceNodeId, target: targetNodeId, sourceHandle: dragPreview.sourceHandle, targetHandle: handleForControlCandidate(dragPreview.sourceHandle) }, "create", undefined, { clientX: event.clientX, clientY: event.clientY }, dragPreview.sourceHandle);
        setPendingSourceNodeId(undefined);
        setPendingSourceHandle(undefined);
        setDragPreview(undefined);
        setNotice(undefined);
        event.preventDefault();
        event.stopPropagation();
      }
      setDragSourceNodeId(undefined);
      setDragPreview(undefined);
    },
    [dragPreview, dragSourceNodeId, finishOverlayReconnect, openConnectionEditor, reconnectDraft, screenToFlowPosition]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/agentcore-node");
      if (!type) return;
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void addNode(skeletonNode(type as Parameters<typeof skeletonNode>[0], pos.x, pos.y));
    },
    [addNode, screenToFlowPosition]
  );

  return (
    <div
      className="relative h-full"
      onClickCapture={onCanvasClickCapture}
      onMouseDownCapture={onCanvasMouseDownCapture}
      onMouseMoveCapture={onCanvasMouseMoveCapture}
      onMouseUpCapture={onCanvasMouseUpCapture}
      onDrop={onDrop}
      onDragOver={(event) => event.preventDefault()}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes: NodeChange[]) => updateNodes(changes)}
        onEdgesChange={(_changes: EdgeChange[]) => undefined}
        onConnect={onConnect}
        onEdgeClick={onNativeEdgeClick}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        onNodeDoubleClick={openPolicyEditor}
        fitView
        minZoom={0.25}
        fitViewOptions={{ padding: 0.16 }}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.Bezier}
        connectionLineStyle={{ stroke: "#39c5bb", strokeWidth: 3, filter: "drop-shadow(0 0 10px rgba(57, 197, 187, 0.75))" }}
        connectOnClick
        connectionRadius={46}
        edgesReconnectable
        reconnectRadius={28}
        nodesConnectable
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <EdgeOverlay activePathEdgeIds={activePathEdgeIds} plannedPathEdgeIds={plannedPathEdgeIds} interactionsDisabled={Boolean(dragSourceNodeId || reconnectDraft)} onEditEdge={onEditEdge} />
        {dragPreview ? <ConnectionPreview preview={dragPreview} scenario={scenario} /> : null}
        {reconnectDraft ? <ReconnectPreview draft={reconnectDraft} scenario={scenario} /> : null}
        <Background color="#243244" />
        <Controls />
      </ReactFlow>
      {notice ? <div className="absolute left-3 top-12 z-20 border border-console-red/60 bg-console-panel px-3 py-2 text-xs text-console-red shadow-xl">{notice}</div> : null}
      {draft ? <ConnectionEditor draft={draft} scenario={scenario} onCancel={cancelDraft} onChange={setDraft} onDelete={deleteDraft} onSave={saveDraft} /> : null}
      {policyDraft ? <PolicyEditor draft={policyDraft} onCancel={() => setPolicyDraft(undefined)} onChange={(json) => setPolicyDraft({ nodeId: policyDraft.nodeId, json })} onSave={savePolicyDraft} /> : null}
    </div>
  );
}

export function TopologyCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
