# AgentCore-Flight-Simulator

Static browser simulator for Amazon Bedrock AgentCore security flows. It models users, client apps, external GenAI agents, a standard OIDC authorization server preset modeled as Keycloak, AgentCore Runtime agents, AgentCore Gateway, AgentCore Identity, local policy enforcement, AgentCore-hosted MCP servers, A2A agents, external MCP adapters, external REST APIs, and SaaS resources.

## What It Does

- Simulates OAuth authorization code + PKCE, local mock JWT signing and validation.
- Simulates Runtime inbound OAuth/JWT and SigV4 behavior.
- Simulates AgentCore Identity workload access tokens, provider resolution, local PEP checks, and downstream OAuth token exchange through Keycloak-modeled providers.
- Simulates Gateway `tools/list`, `tools/call`, policy decisions, MCP streaming progress, direct MCP bypass, direct A2A, and Gateway-mediated Runtime targets.
- Models SigV4 as a first-class path, including Gateway -> Runtime SigV4 and optional custom OAuth context headers such as `X-AgentCore-Forwarded-OAuth-Token`.
- Models external GenAI agents that are not running in AgentCore. They can call Gateway, AgentCore Runtime, AgentCore-hosted MCP servers, external MCP servers, external APIs, or Keycloak using the protocol/auth combinations configured on the edge.
- Models client applications as possible technical MCP clients for Gateway when explicitly represented and authorized.
- Supports handle-to-handle topology drag and drop. Line clicks open a connection editor with dropdowns for relation type, auth mode, and Identity credential provider.
- Keeps invalid relationships visible as red dashed edges and emits security findings for them.
- Shows one managed `Steps` panel. Users can add an edge action as a step, reorder, duplicate, delete, edit action/auth/tool dropdowns, or use `Magic Path` to derive the most governed route. The matching topology edge is highlighted directly on the canvas.
- Models OAuth `resource` indicators and RAR `authorization_details` in authorization requests, token requests, mock JWT claims, token exchange, and inspectors. `scope` remains visible for compatibility with MCP/OAuth clients.
- Lets you double click a Policy Engine node to edit an `agentcore-gateway-policy/v1` JSON document and apply it back to the local Gateway policy simulator.
- Persists scenarios in `localStorage`, and supports JSON import/export and Mermaid sequence export.

## What It Does Not Do

- It does not call AWS, Google, Slack, GitHub, Workday, or any external service.
- It does not use real credentials, real API keys, real AWS signing keys, or real SaaS tokens.
- It does not implement full Cedar or full SigV4 cryptography. It exposes deterministic, inspectable simulations for learning and design review.
- Workday is labeled as a simulated SaaS MCP adapter, not an official Workday MCP server.

## Run

```bash
npm install
npm run dev
npm run build
npm run preview
npm run test
```

## Add A Node Type

1. Add the type and interface in `src/model/nodes.ts`.
2. Extend `scenarioSchema` only if stricter validation is needed.
3. Add a palette skeleton in `src/app/components/Palette/Palette.tsx`.
4. Add legal edge rules in `src/model/edges.ts`.
5. Add simulator behavior in `src/engine/simulate.ts` or a focused step file under `src/engine/steps/`.

## Add A Scenario

1. Add a JSON file under `src/scenarios/`.
2. Import it in `src/scenarios/index.ts`.
3. Include nodes, typed edges, prompt, mutations, and learning outcomes.
4. Run `npm run test` and `npm run build`.

## Add A Mutation

1. Add the mutation metadata in `src/scenarios/common.ts`.
2. Implement the behavior in `src/engine/simulate.ts` or the relevant step helper.
3. Add a focused Vitest case under `src/test/`.

## Supported Connectivity Matrix

Every connection is selected from a dropdown. Invalid combinations can still be drawn, but they stay red and produce an invalid-topology finding instead of being simulated as valid.

| Source | Target | Edge type | Protocol model | Auth modes |
| --- | --- | --- | --- | --- |
| User | Client App | `user_to_client` | Browser navigation | None |
| User | AgentCore Runtime | `user_to_runtime` | HTTP Runtime invoke | OAuth/JWT, SigV4, none |
| Client App | Keycloak AS | `client_to_idp` | OIDC/OAuth | OAuth/JWT |
| Client App | AgentCore Runtime | `client_to_runtime` | HTTP Runtime invoke | OAuth/JWT, SigV4, none |
| Client App | AgentCore Gateway | `client_to_gateway_mcp` | MCP over HTTP | OAuth/JWT, SigV4, none |
| Client App | External API | `client_to_external_api` | HTTP API | OAuth/JWT, none |
| External GenAI Agent | Keycloak AS | `external_agent_to_authorization_server` | OAuth client | OAuth/JWT |
| External GenAI Agent | AgentCore Gateway | `external_agent_to_gateway_mcp` | MCP over HTTP | OAuth/JWT, SigV4, none |
| External GenAI Agent | AgentCore Runtime | `external_agent_to_runtime_http` | HTTP Runtime invoke | OAuth/JWT, SigV4, none |
| External GenAI Agent | AgentCore Runtime | `external_agent_to_runtime_a2a` | A2A discovery/message | OAuth/JWT, SigV4, none |
| External GenAI Agent | AgentCore MCP / External MCP | `external_agent_to_mcp_direct` | MCP over HTTP | OAuth/JWT, SigV4, none |
| External GenAI Agent | External API | `external_agent_to_external_api` | HTTP API | OAuth/JWT, none |
| AgentCore Runtime | AgentCore Runtime | `runtime_to_runtime_http` / `runtime_to_runtime_a2a` | HTTP or A2A | OAuth/JWT, SigV4, none |
| AgentCore Runtime | AgentCore Gateway | `runtime_to_gateway_mcp` | MCP over HTTP | OAuth/JWT, SigV4, none |
| AgentCore Runtime | MCP Server | `runtime_to_mcp_direct` | MCP over HTTP | OAuth/JWT, SigV4, none |
| AgentCore Runtime | External API | `runtime_to_external_api` | HTTP API | OAuth/JWT, none |
| AgentCore Gateway | AgentCore Runtime | `gateway_to_http_runtime_target` | HTTP target proxy | OAuth/JWT, SigV4, none |
| AgentCore Gateway | MCP Server | `gateway_to_mcp_target` | MCP target aggregation | OAuth/JWT, SigV4, none |
| AgentCore Gateway | External API | `gateway_to_external_api_target` | HTTP API target | OAuth/JWT, SigV4, none |
| AgentCore Runtime / Gateway / Identity | Keycloak AS | OAuth provider/client/interceptor edges | OAuth/OIDC | OAuth/JWT |

For SigV4 edges where user context matters, enable `Send inbound OAuth/JWT as custom context header` and choose one of the allowlisted header names. The simulator treats that header as context, not as primary authentication.

## Steps And Branch Analysis

The bottom `Steps` panel is the execution plan. It replaces the previous timeline/path split.

- Creating a connection automatically creates a default step.
- Clicking an edge selects its step; if missing, the simulator can add one for that edge.
- Clicking a step highlights exactly that diagram action and selects its first protocol event for inspection.
- Each step can be moved up/down, duplicated, deleted, and edited through dropdowns for action, auth strategy, branch, and tool.
- `Magic Path` rebuilds the order from topology: user/client auth first, runtime ingress, workload identity, Gateway policy/Identity, provider/token exchange, then target calls. Governed Gateway paths are preferred over direct paths unless the scenario is a comparison.
- `Run` executes steps in order. A failed step is red; later steps are skipped unless the scenario is a direct-vs-Gateway comparison branch.
- The panel has internal scroll and horizontal overflow so short and long simulations remain manageable.

For branch analysis, assign `branchId` values such as `direct` and `gateway`. Each branch can show its own failure without hiding the other branch.

## OAuth Delegation And Token Exchange Model

The simulator distinguishes three downstream-token strategies:

| Strategy | Meaning | Subject / actor model |
| --- | --- | --- |
| `OBO_TOKEN_EXCHANGE` | AgentCore Identity exchanges the inbound user JWT for a downstream resource token. | `sub` remains the user; `act` identifies the agent/workload actor. |
| `SCOPED_CLIENT_TOKEN` | Identity asks Keycloak for a new client-credentials token scoped to the agent/client/Gateway. | `sub` is the client/actor; no user subject is preserved. |
| `TOKEN_EXCHANGE_REQUESTED_PERMISSIONS` | Identity performs RFC 8693 token exchange while requesting a specific resource and scope set. | Keycloak/AS must re-authorize the requested `resource` and `scope`; scopes are not silently expanded. |

The initial authorization request normally asks only for the immediate protected resource, using RFC 8707 `resource`. If an agent later needs Gateway, MCP, or SaaS access, it must request a new scoped token or token exchange with a fresh `resource` and RAR `authorization_details`. Requesting broad permissions up front is possible in the model, but should be treated as a least-privilege warning.

RAR `authorization_details` are represented as typed objects, for example:

```json
[
  {
    "type": "mcp",
    "locations": ["https://enterprise-tools-abcdefghij.gateway.bedrock-agentcore.us-west-2.amazonaws.com/mcp"],
    "actions": ["tools/list", "tools/call"],
    "tools": ["google_drive.search_files"]
  }
]
```

Credential providers can define:

- `allowedWorkloadIdentities`: workloads allowed to use the provider.
- `allowedClients`: clients/actors allowed to request tokens through the provider.
- `allowedResources`: downstream resources/audiences the provider can target.
- `scopes`: maximum scope set that can be requested.
- `allowTokenExchange`: whether token exchange is allowed.
- `allowSubjectDelegation`: whether a user subject may be delegated to the actor.
- `tokenExchange.grantType`: `TOKEN_EXCHANGE` or `JWT_AUTHORIZATION_GRANT`.
- `tokenExchange.actorTokenContent`: `M2M`, `AWS_IAM_ID_TOKEN_JWT`, or `NONE`.

For policy simulation, actor and subject are exposed separately:

- `principal.getTag("sub")`: OAuth-authenticated Gateway principal subject, derived from JWT `sub`.
- `principal.getTag("scope")`: OAuth scopes available as principal tags.
- `principal.id`: IAM principal for SigV4/AWS_IAM Gateway auth.
- `context.token.sub`: effective subject in an exchanged token.
- `context.token.act.sub`: current actor in an exchanged token.
- `context.input.*`: Gateway tool arguments, following AgentCore Policy/Cedar guidance.

This lets policies choose whether to authorize based on the user (`sub`), the agent/client (`act`), both, or the tool input. Example local DSL:

```text
principal.hasTag('scope') &&
principal.getTag('scope') like '*mcp.tools.call*' &&
context.token.act.sub == 'travel-expense-agent' &&
context.token.sub == 'user-alice' &&
context.input.amount < 500
```

## Security Limitations

All tokens, signatures, API responses, claims, and credentials are simulated. JWTs are locally signed with a static test secret, and SigV4 signatures use labels such as `SIGV4_SIGNATURE_SIMULATED`. Do not use this application to validate production authorization decisions.

## Realism Notes

- OAuth bearer failures return `401` with protected-resource metadata when the resource is OAuth/JWT configured.
- SigV4 failures return `403 ACCESS_DENIED` without `WWW-Authenticate`.
- When `Authorization` is occupied by SigV4, the simulator can model a custom OAuth context header for user binding. The header must be allowlisted, validated, redacted from logs, and treated as user context rather than primary authentication.
- Each Identity -> Keycloak edge represents a specific credential provider relationship. Identity resolves the provider, verifies the WAT-bound workload/client, evaluates the PEP, then calls the simulated Keycloak token endpoint.
- Gateway-mediated paths show central policy and audit. Direct MCP and direct A2A paths intentionally raise governance warnings.
- External agents are modeled as ordinary OAuth/SigV4-capable clients. They are not AgentCore workloads unless the topology explicitly routes them through AgentCore Gateway or Runtime.
- Runtime protocols are modeled as HTTP, MCP, A2A, and AG-UI-capable surfaces. A2A discovery uses `/.well-known/agent.json`.
- AgentCore-hosted MCP servers are shown as AgentCore Runtime invocation resources while preserving MCP JSON-RPC request semantics and `Mcp-Session-Id` behavior.

## QA Checklist

Current automated coverage:

| Check | Status |
| --- | --- |
| Keycloak endpoints instead of Cognito | OK |
| JWT audience, issuer, expiry and scope failures | OK |
| Gateway policy deny and tools/list filtering | OK |
| Direct MCP bypass and missing `Mcp-Session-Id` warning | OK |
| OBO token preserves user and workload identity | OK |
| Gateway -> Runtime SigV4 success/failure modes | OK |
| Edge-selected custom OAuth context header on SigV4 | OK |
| External client/agent/Gateway/MCP/API connectivity matrix | OK |
| Invalid Client App -> MCP relation rejected by legal-edge matrix | OK |
| Token exchange denied when requested downstream scope exceeds provider grant | OK |
| Steps migration, auto-step for new edges, Magic Path order, and stop/skip on failure | OK |
| RFC 8707 `resource` and RAR `authorization_details` on OAuth/token inspector paths | OK |
| AgentCore-style policy DSL for `principal.hasTag`, `principal.getTag`, `like`, `context.input`, `act` and `sub` | OK |
| Steps short path, long path, Magic Path, move, delete, duplicate, internal scroll and viewport fit | OK |

Manual browser validation should cover desktop rendering, connection create/edit/delete/reconnect, dropdown-only connection editing, managed timeline path selection, highlighted path edges, and scenario JSON import/export.

## Sources Used For Realism

- [AWS AgentCore Policy core concepts](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-core-concepts.html): Gateway, targets, OAuthUser/IamEntity principals, Cedar, default-deny and forbid-wins semantics.
- [AWS AgentCore Policy conditions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-conditions.html): `principal.hasTag`, `principal.getTag`, scope matching, IAM `principal.id`, and `context.input`.
- [AWS AgentCore Identity OBO token exchange](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/on-behalf-of-token-exchange.html): `GetWorkloadAccessTokenForJWT`, `GetResourceOauth2Token`, `ON_BEHALF_OF_TOKEN_EXCHANGE`, `TOKEN_EXCHANGE`, `JWT_AUTHORIZATION_GRANT`, `actor_token_content`.
- [RFC 8693 OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693): `subject_token`, `actor_token`, `resource`, `scope`, delegation versus impersonation, and JWT `act` semantics.
- [RFC 8707 OAuth 2.0 Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707): resource-bound token requests for protected resources.
- [RFC 9396 OAuth 2.0 Rich Authorization Requests](https://www.rfc-editor.org/rfc/rfc9396): structured `authorization_details` for fine-grained authorization.
- [MCP draft authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization): MCP authorization metadata and OAuth compatibility expectations.
