import type { TimelineEvent } from "../../model/events";
import type { AuthorizationServerNode, ClientAppNode, UserNode } from "../../model/nodes";
import type { TokenArtifact, TokenAuthorizationDetail } from "../../model/auth";

interface EventBase {
  index: number;
  traceId: string;
  correlationId: string;
}

export function oauthPkceEvents(args: {
  base: EventBase;
  user: UserNode;
  client: ClientAppNode;
  idp: AuthorizationServerNode;
  token: TokenArtifact;
  scopes: string[];
  resource?: string;
  authorizationDetails?: TokenAuthorizationDetail[];
}): TimelineEvent[] {
  const authorizationEndpoint = args.idp.authorizationEndpoint ?? `${args.idp.issuer}/protocol/openid-connect/auth`;
  const tokenEndpoint = args.idp.tokenEndpoint ?? `${args.idp.issuer}/protocol/openid-connect/token`;
  const authorizeUrl = new URL(authorizationEndpoint);
  authorizeUrl.search = [
    "response_type=code",
    `client_id=${encodeURIComponent(args.client.clientId)}`,
    `redirect_uri=${encodeURIComponent(args.client.redirectUri)}`,
    `scope=${encodeURIComponent(args.scopes.join(" "))}`,
    args.resource ? `resource=${encodeURIComponent(args.resource)}` : "",
    args.authorizationDetails?.length ? `authorization_details=${encodeURIComponent(JSON.stringify(args.authorizationDetails))}` : "",
    "code_challenge=PKCE_CHALLENGE_SIMULATED",
    "code_challenge_method=S256",
    "state=STATE_SIMULATED"
  ].filter(Boolean).join("&");
  const host = authorizeUrl.host;
  const tokenHost = new URL(tokenEndpoint).host;
  const tokenBody = [
    "grant_type=authorization_code",
    `client_id=${args.client.clientId}`,
    "code=AUTH_CODE_123",
    `redirect_uri=${encodeURIComponent(args.client.redirectUri)}`,
    "code_verifier=PKCE_VERIFIER_SIMULATED",
    args.resource ? `resource=${encodeURIComponent(args.resource)}` : "",
    args.authorizationDetails?.length ? `authorization_details=${encodeURIComponent(JSON.stringify(args.authorizationDetails))}` : ""
  ].filter(Boolean).join("&");
  const common = {
    traceId: args.base.traceId,
    correlationId: args.base.correlationId
  };
  return [
    {
      ...common,
      id: "oauth-authorize",
      index: args.base.index,
      title: "Authorization request + PKCE",
      sourceNodeId: args.client.id,
      targetNodeId: args.idp.id,
      protocol: "OAuth2",
      method: "GET",
      url: authorizeUrl.toString(),
      request: { headers: { Host: host }, body: undefined },
      response: { status: 302, headers: { Location: `${args.client.redirectUri}?code=AUTH_CODE_123&state=STATE_SIMULATED` } },
      verdict: { outcome: "info", reason: "Client starts standard OIDC authorization code flow with PKCE.", securityNotes: ["PKCE binds the authorization code to this client instance."] }
    },
    {
      ...common,
      id: "oauth-login",
      index: args.base.index + 1,
      title: "User login",
      sourceNodeId: args.user.id,
      targetNodeId: args.idp.id,
      protocol: "OIDC",
      method: "POST",
      url: `${authorizationEndpoint}/login`,
      request: { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "username=alice&password=PASSWORD_NOT_STORED" },
      response: { status: 200, body: { authenticated: true, subject: args.user.id } },
      verdict: { outcome: "allow", reason: "The IdP authenticates the simulated user.", securityNotes: ["No real password is stored or transmitted."] }
    },
    {
      ...common,
      id: "oauth-consent",
      index: args.base.index + 2,
      title: "Consent",
      sourceNodeId: args.user.id,
      targetNodeId: args.idp.id,
      protocol: "OAuth2",
      method: "POST",
      url: `${authorizationEndpoint}/consent`,
      request: { body: { client_id: args.client.clientId, scopes: args.scopes, resource: args.resource, authorization_details: args.authorizationDetails } },
      response: { status: 200, body: { consent: "granted" } },
      verdict: { outcome: "info", reason: "The user grants the requested scopes.", securityNotes: ["Consent does not override resource server audience validation."] }
    },
    {
      ...common,
      id: "oauth-callback",
      index: args.base.index + 3,
      title: "Authorization code callback",
      sourceNodeId: args.idp.id,
      targetNodeId: args.client.id,
      protocol: "OAuth2",
      method: "GET",
      url: `${args.client.redirectUri}?code=AUTH_CODE_123&state=STATE_SIMULATED`,
      request: { headers: { Host: new URL(args.client.redirectUri).host } },
      response: { status: 302, body: { code: "AUTH_CODE_123", state: "STATE_SIMULATED" } },
      verdict: { outcome: "allow", reason: "State matches the browser session.", securityNotes: ["Authorization code is short lived and not a token."] }
    },
    {
      ...common,
      id: "oauth-token-request",
      index: args.base.index + 4,
      title: "Token request",
      sourceNodeId: args.client.id,
      targetNodeId: args.idp.id,
      protocol: "OAuth2",
      method: "POST",
      url: tokenEndpoint,
      request: { headers: { Host: tokenHost, "Content-Type": "application/x-www-form-urlencoded" }, body: tokenBody },
      response: { status: 200, body: { token_type: "Bearer", expires_in: 3600 } },
      verdict: { outcome: "allow", reason: "Authorization code and PKCE verifier are accepted.", securityNotes: ["The client secret is not used for this SPA-style simulation."] }
    },
    {
      ...common,
      id: "oauth-token-response",
      index: args.base.index + 5,
      title: "Access token response",
      sourceNodeId: args.idp.id,
      targetNodeId: args.client.id,
      protocol: "OAuth2",
      method: "POST",
      url: tokenEndpoint,
      request: { headers: { Host: tokenHost, "Content-Type": "application/x-www-form-urlencoded" }, body: tokenBody },
      response: { status: 200, body: { access_token: "ACCESS_TOKEN_SIMULATED", token_type: "Bearer", expires_in: 3600, scope: args.scopes.join(" "), resource: args.resource, authorization_details: args.authorizationDetails } },
      token: args.token,
      verdict: { outcome: "allow", reason: "A locally signed mock JWT is issued.", securityNotes: ["The JWT is real locally signed test data, not a real IdP token."] }
    }
  ];
}
