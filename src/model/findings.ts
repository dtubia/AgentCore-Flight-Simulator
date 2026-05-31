export type FindingType =
  | "missing_inbound_auth"
  | "wrong_audience"
  | "wrong_issuer"
  | "expired_token"
  | "missing_scope"
  | "overbroad_scope"
  | "missing_user_binding"
  | "confused_deputy_risk"
  | "direct_tool_call_bypasses_gateway_policy"
  | "direct_agent_call_bypasses_gateway_policy"
  | "mcp_session_id_missing"
  | "policy_default_deny"
  | "policy_log_only"
  | "autonomous_credential_used_for_user_action"
  | "sensitive_tool_requires_human_approval"
  | "external_mcp_server_untrusted"
  | "api_key_static_secret_risk"
  | "obo_preserves_user_context"
  | "least_privilege_ok"
  | "sigv4_auth_failed"
  | "sigv4_gateway_to_runtime_ok"
  | "forwarded_oauth_context_header"
  | "forwarded_oauth_context_missing"
  | "token_exchange_scope_escalation_denied"
  | "token_exchange_actor_subject_policy"
  | "scoped_client_token_used"
  | "invalid_topology_edge";

export interface SecurityFinding {
  type: FindingType;
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  explanation: string;
  affectedNodes: string[];
  remediation: string;
}
