import type { TimelineEvent } from "../../model/events";
import type { AgentCoreIdentityNode, AgentCoreRuntimeAgentNode, AgentCoreGatewayNode, AuthorizationServerNode, CredentialProvider } from "../../model/nodes";

type IdentityOauthFlow = "ON_BEHALF_OF_TOKEN_EXCHANGE" | "CLIENT_CREDENTIALS";
type OAuthTokenStrategy = "OBO_TOKEN_EXCHANGE" | "SCOPED_CLIENT_TOKEN" | "TOKEN_EXCHANGE_REQUESTED_PERMISSIONS";

export function workloadTokenEvent(args: {
  index: number;
  traceId: string;
  correlationId: string;
  runtime: AgentCoreRuntimeAgentNode;
  identity: AgentCoreIdentityNode;
  subject: string;
  issuer: string;
}): TimelineEvent {
  return {
    id: "identity-workload-token",
    index: args.index,
    title: "Get workload access token",
    sourceNodeId: args.runtime.id,
    targetNodeId: args.identity.id,
    protocol: "AgentCoreIdentity",
    method: "POST",
    url: "https://bedrock-agentcore.us-west-2.amazonaws.com/identities/GetWorkloadAccessTokenForJWT",
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { headers: { "Content-Type": "application/json" }, body: { workloadName: args.runtime.workloadIdentity.name, userToken: "ACCESS_TOKEN_SIMULATED" } },
    response: {
      status: 200,
      body: {
        workloadAccessToken: "WAT_OPAQUE_TOKEN_SIMULATED",
        boundSubject: { iss: args.issuer, sub: args.subject },
        boundWorkloadIdentity: args.runtime.workloadIdentity.name
      }
    },
    token: {
      label: "WAT_OPAQUE_TOKEN_SIMULATED",
      kind: "workload",
      boundActor: args.runtime.workloadIdentity.name,
      boundSubject: args.subject
    },
    verdict: {
      outcome: "allow",
      reason: "Runtime exchanges the inbound JWT for a workload access token.",
      securityNotes: [
        `Identity validates the inbound user token against trusted issuer metadata: ${args.issuer}.`,
        "Workload access tokens are for AgentCore first-party services only and must not be accepted by external SaaS APIs."
      ]
    }
  };
}

function downstreamLabel(providerName: string, flow: IdentityOauthFlow): string {
  const normalized = providerName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? `DOWNSTREAM_${normalized}_ACCESS_TOKEN_SIMULATED` : `DOWNSTREAM_${normalized}_CLIENT_CREDENTIALS_TOKEN_SIMULATED`;
}

function resolveProvider(identity: AgentCoreIdentityNode, providerName: string): CredentialProvider | undefined {
  return identity.credentialProviders.find((provider) => provider.name === providerName);
}

function providerTokenEndpoint(provider: CredentialProvider | undefined, authorizationServer: AuthorizationServerNode): string {
  return provider?.tokenEndpoint ?? authorizationServer.tokenEndpoint ?? `${authorizationServer.issuer}/protocol/openid-connect/token`;
}

function providerIssuer(provider: CredentialProvider | undefined, authorizationServer: AuthorizationServerNode): string {
  return provider?.issuer ?? authorizationServer.issuer;
}

export function identityOutboundOauthEvents(args: {
  index: number;
  traceId: string;
  correlationId: string;
  gateway: AgentCoreGatewayNode;
  identity: AgentCoreIdentityNode;
  authorizationServer: AuthorizationServerNode;
  providerName: string;
  flow: IdentityOauthFlow;
  scopes: string[];
  requestedResource?: string;
  tokenStrategy?: OAuthTokenStrategy;
  requestedSubjectMode?: "subject" | "actor";
  actor: string;
  subject: string;
}): TimelineEvent[] {
  const provider = resolveProvider(args.identity, args.providerName);
  const tokenStrategy: OAuthTokenStrategy = args.tokenStrategy ?? (args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "OBO_TOKEN_EXCHANGE" : "SCOPED_CLIENT_TOKEN");
  const actorTokenContent = provider?.tokenExchange?.actorTokenContent ?? "M2M";
  const allowedWorkload = Boolean(provider?.allowedWorkloadIdentities.includes(args.actor));
  const clientAllowed = !provider?.allowedClients?.length || provider.allowedClients.includes(args.actor);
  const resourceAllowed = !provider?.allowedResources?.length || Boolean(args.requestedResource && provider.allowedResources.includes(args.requestedResource));
  const exchangeAllowed = args.flow !== "ON_BEHALF_OF_TOKEN_EXCHANGE" || provider?.allowTokenExchange !== false;
  const subjectDelegationAllowed = args.flow !== "ON_BEHALF_OF_TOKEN_EXCHANGE" || provider?.allowSubjectDelegation !== false;
  const scopesAllowed = Boolean(provider && args.scopes.every((scope) => provider.scopes.includes(scope)));
  const flowAllowed = Boolean(provider && provider.flow === args.flow);
  const tokenEndpoint = providerTokenEndpoint(provider, args.authorizationServer);
  const issuer = providerIssuer(provider, args.authorizationServer);
  const requestAccepted = Boolean(provider && allowedWorkload && clientAllowed && resourceAllowed && exchangeAllowed && subjectDelegationAllowed && scopesAllowed && flowAllowed);
  const tokenLabel = downstreamLabel(args.providerName, args.flow);
  const host = new URL(tokenEndpoint).host;
  const actClaim = args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? { sub: args.actor, iss: "agentcore-identity", token_source: actorTokenContent } : undefined;
  const tokenRequestBody =
    args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE"
      ? [
          "grant_type=urn:ietf:params:oauth:grant-type:token-exchange",
          "subject_token=ACCESS_TOKEN_SIMULATED",
          "subject_token_type=urn:ietf:params:oauth:token-type:access_token",
          actorTokenContent === "NONE" ? "" : `actor_token=${actorTokenContent === "M2M" ? "M2M_ACTOR_TOKEN_SIMULATED" : "AWS_IAM_ID_TOKEN_JWT_SIMULATED"}`,
          actorTokenContent === "NONE" ? "" : `actor_token_type=${actorTokenContent === "M2M" ? "urn:ietf:params:oauth:token-type:access_token" : "urn:ietf:params:oauth:token-type:jwt"}`,
          "requested_token_type=urn:ietf:params:oauth:token-type:access_token",
          `resource=${encodeURIComponent(args.requestedResource ?? args.providerName)}`,
          `audience=${encodeURIComponent(args.providerName)}`,
          `scope=${encodeURIComponent(args.scopes.join(" "))}`,
          `authorization_details=${encodeURIComponent(JSON.stringify([{ type: "mcp", locations: [args.requestedResource ?? args.providerName], actions: ["tools/call"], credentialProvider: args.providerName }]))}`
        ].filter(Boolean).join("&")
      : `grant_type=client_credentials&client_id=${encodeURIComponent(args.actor)}&client_assertion=WORKLOAD_IDENTITY_ASSERTION_SIMULATED&scope=${encodeURIComponent(args.scopes.join(" "))}&resource=${encodeURIComponent(args.requestedResource ?? args.providerName)}&authorization_details=${encodeURIComponent(JSON.stringify([{ type: "mcp", locations: [args.requestedResource ?? args.providerName], actions: ["tools/call"], credentialProvider: args.providerName }]))}`;

  const requestEvent: TimelineEvent = {
    id: `identity-resolve-provider-${args.providerName}`,
    index: args.index,
    title: "Resolve Identity credential provider",
    sourceNodeId: args.gateway.id,
    targetNodeId: args.identity.id,
    protocol: "AgentCoreIdentity",
    method: "POST",
    url: "https://bedrock-agentcore.us-west-2.amazonaws.com/identities/GetResourceOauth2Token",
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: {
      headers: { "Content-Type": "application/json" },
      body: {
        resourceCredentialProviderName: args.providerName,
        oauth2Flow: args.flow,
        tokenStrategy,
        scopes: args.scopes,
        requestedResource: args.requestedResource ?? args.providerName,
        workloadIdentityToken: "WAT_OPAQUE_TOKEN_SIMULATED",
        tokenVaultArn: args.identity.tokenVault.arn
      }
    },
    response: {
      status: requestAccepted ? 202 : 400,
      body: {
        provider: provider
          ? {
              name: provider.name,
              vendor: provider.vendor,
              flow: provider.flow,
              authorizationServerId: provider.authorizationServerId ?? args.authorizationServer.id,
              issuer,
              tokenEndpoint
            }
          : null,
        validation: {
          providerFound: Boolean(provider),
          workloadAllowed: allowedWorkload,
          clientAllowed,
          resourceAllowed,
          exchangeAllowed,
          subjectDelegationAllowed,
          scopesAllowed,
          flowAllowed,
          actorTokenContent,
          tokenVaultSelected: args.identity.tokenVault.arn
        },
        next: requestAccepted ? "CALL_AUTHORIZATION_SERVER_TOKEN_ENDPOINT" : "REJECT"
      }
    },
    verdict: {
      outcome: requestAccepted ? "allow" : "deny",
      reason: requestAccepted ? "Identity selected a credential provider and token vault entry for the requested OAuth flow." : "Identity rejected the outbound OAuth request before contacting the authorization server.",
      securityNotes: [
        "Provider resolution checks workload identity, client permission, requested resource, requested scopes and configured OAuth flow.",
        "The token vault stores provider configuration and simulated grants; no real client secret is present."
      ]
    }
  };

  const pepEvent: TimelineEvent = {
    id: `identity-pep-${args.providerName}`,
    index: args.index + 1,
    title: "Identity PEP provider decision",
    sourceNodeId: args.identity.id,
    targetNodeId: args.identity.id,
    protocol: "Policy",
    method: "EVALUATE",
    url: `local-pep://agentcore-identity/${args.providerName}`,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: {
      body: {
        principal: args.actor,
        action: "identity:GetResourceOauth2Token",
        resource: args.providerName,
        context: {
          workloadIdentityToken: "WAT_OPAQUE_TOKEN_SIMULATED",
          requestedFlow: args.flow,
          tokenStrategy,
          requestedResource: args.requestedResource ?? args.providerName,
          requestedScopes: args.scopes,
          boundSubject: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? args.subject : null,
          boundActor: args.actor,
          actorTokenContent,
          actClaim,
          policyEvaluationSubject: args.requestedSubjectMode ?? (args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "subject" : "actor"),
          tokenVaultArn: args.identity.tokenVault.arn
        }
      }
    },
    response: {
      status: requestAccepted ? 200 : 403,
      body: {
        providerFound: Boolean(provider),
        workloadAllowed: allowedWorkload,
        clientAllowed,
        resourceAllowed,
        exchangeAllowed,
        subjectDelegationAllowed,
        scopesAllowed,
        flowAllowed,
        policyInputs: {
          actor: args.actor,
          subject: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? args.subject : null,
          act: actClaim,
          scope: args.scopes.join(" ")
        },
        decision: requestAccepted ? "allow" : "deny"
      }
    },
    policyDecision: {
      engineId: "agentcore-identity-pep",
      mode: "ENFORCE",
      effect: requestAccepted ? "allow" : "deny",
      matchedPolicies: [
        provider ? `provider:${provider.name}` : "provider:not-found",
        allowedWorkload ? "workload-identity:allowed" : "workload-identity:denied",
        clientAllowed ? "client:allowed" : "client:denied",
        resourceAllowed ? "resource:allowed" : "resource:denied",
        exchangeAllowed ? "token-exchange:allowed" : "token-exchange:denied",
        subjectDelegationAllowed ? "subject-delegation:allowed" : "subject-delegation:denied",
        scopesAllowed ? "scopes:allowed" : "scopes:denied",
        flowAllowed ? "flow:allowed" : "flow:denied"
      ],
      defaultDeny: !requestAccepted,
      explanation: requestAccepted
        ? "AgentCore Identity PEP recognized the WAT-bound workload/client and allowed the provider, resource, flow, scopes and delegation semantics."
        : "AgentCore Identity PEP denied by default because provider, workload, client, resource, token-exchange grant, subject delegation, flow or scopes did not match."
    },
    verdict: {
      outcome: requestAccepted ? "allow" : "deny",
      reason: requestAccepted ? "Identity PEP allowed this workload to use the configured Keycloak provider." : "Identity PEP denied this workload/provider request.",
      securityNotes: [
        "The WAT binds the calling workload identity and is evaluated before the Keycloak token endpoint is used.",
        "Policy can distinguish actor/client permissions from subject/user permissions. The simulator exposes actor, subject and act-claim context for inspection.",
        "Each Identity -> Keycloak edge represents one credential provider relationship."
      ]
    }
  };

  const authorizationServerEvent: TimelineEvent = {
    id: `identity-as-token-${args.providerName}`,
    index: args.index + 2,
    title: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "Keycloak token exchange" : "Keycloak client credentials grant",
    sourceNodeId: args.identity.id,
    targetNodeId: args.authorizationServer.id,
    protocol: "OAuth2",
    method: "POST",
    url: tokenEndpoint,
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: {
      headers: { Host: host, "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenRequestBody
    },
    response: requestAccepted
      ? {
          status: 200,
          body: {
            token_type: "Bearer",
            issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
            access_token: tokenLabel,
            expires_in: 3600,
            issuer,
            scope: args.scopes.join(" "),
            resource: args.requestedResource ?? args.providerName,
            authorization_details: [{ type: "mcp", locations: [args.requestedResource ?? args.providerName], actions: ["tools/call"], credentialProvider: args.providerName }],
            delegation: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? { actor: args.actor, subject: args.subject, act: actClaim } : { actor: args.actor, subject: null },
            claims: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? { sub: args.subject, act: actClaim, scope: args.scopes.join(" ") } : { sub: args.actor, scope: args.scopes.join(" ") }
          }
        }
      : {
          status: 400,
          body: { error: "invalid_request", error_description: "Identity provider resolution failed before token endpoint call." }
        },
    token: {
      label: tokenLabel,
      kind: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "obo" : "autonomous",
      boundActor: args.actor,
      boundSubject: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? args.subject : undefined,
      downstreamAudience: args.requestedResource ?? issuer,
      resource: args.requestedResource ?? args.providerName,
      authorizationDetails: [{ type: "mcp", locations: [args.requestedResource ?? args.providerName], actions: ["tools/call"], credentialProvider: args.providerName }]
    },
    verdict: {
      outcome: requestAccepted ? (args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "allow" : "warn") : "deny",
      reason: requestAccepted
        ? args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE"
          ? "Keycloak issued a simulated token-exchange result that preserves user and workload identity."
          : "Keycloak issued a simulated scoped client-credentials token without user binding."
        : "No outbound OAuth token was issued.",
      securityNotes:
        args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE"
          ? [
              "Downstream authorization can evaluate both the subject user and the current actor.",
              tokenStrategy === "TOKEN_EXCHANGE_REQUESTED_PERMISSIONS" ? "Requested scopes are newly evaluated by the authorization server; they are not automatically inherited." : "The token is scoped to the requested resource/audience."
            ]
          : ["Use scoped client tokens only for service actions that do not claim to act as a human user."]
    }
  };

  const responseEvent: TimelineEvent = {
    id: `identity-outbound-${args.providerName}`,
    index: args.index + 3,
    title: "Return resource OAuth token",
    sourceNodeId: args.identity.id,
    targetNodeId: args.gateway.id,
    protocol: "AgentCoreIdentity",
    method: "POST",
    url: "https://bedrock-agentcore.us-west-2.amazonaws.com/identities/GetResourceOauth2Token",
    traceId: args.traceId,
    correlationId: args.correlationId,
    request: { body: { requestId: `resource-oauth-${args.providerName}`, providerName: args.providerName } },
    response: requestAccepted
      ? {
          status: 200,
          body: {
            accessToken: tokenLabel,
            tokenType: "Bearer",
            expiresIn: 3600,
            scope: args.scopes.join(" "),
            resource: args.requestedResource ?? args.providerName,
            authorization_details: [{ type: "mcp", locations: [args.requestedResource ?? args.providerName], actions: ["tools/call"], credentialProvider: args.providerName }],
            strategy: tokenStrategy,
            delegation: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? { actor: args.actor, subject: args.subject, act: actClaim } : { actor: args.actor, subject: null },
            tokenVaultArn: args.identity.tokenVault.arn
          }
        }
      : {
          status: 400,
          body: { code: "IDENTITY_PROVIDER_RESOLUTION_FAILED", providerName: args.providerName }
        },
    token: {
      label: tokenLabel,
      kind: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "obo" : "autonomous",
      boundActor: args.actor,
      boundSubject: args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? args.subject : undefined,
      downstreamAudience: args.requestedResource ?? args.providerName,
      resource: args.requestedResource ?? args.providerName,
      authorizationDetails: [{ type: "mcp", locations: [args.requestedResource ?? args.providerName], actions: ["tools/call"], credentialProvider: args.providerName }]
    },
    verdict: {
      outcome: requestAccepted ? (args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE" ? "allow" : "warn") : "deny",
      reason: requestAccepted
        ? args.flow === "ON_BEHALF_OF_TOKEN_EXCHANGE"
          ? "Identity returned a resource token that preserves subject and actor identity."
          : "Identity returned a scoped client token with no subject/user binding."
        : "Identity could not return a downstream token.",
      securityNotes: [
        "The downstream token label is simulated; no external network call or secret is used.",
        "Identity can use Keycloak as a standard OAuth/OIDC authorization server without provider-specific assumptions."
      ]
    }
  };

  return [requestEvent, pepEvent, authorizationServerEvent, responseEvent];
}
