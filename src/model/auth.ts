export type AuthMode = "OAUTH_JWT" | "AWS_IAM_SIGV4" | "NONE";

export interface TokenAuthorizationDetail {
  type: string;
  locations?: string[];
  actions?: string[];
  resources?: string[];
  tools?: string[];
  [key: string]: unknown;
}

export interface SigV4AuthConfig {
  region: string;
  service: "bedrock-agentcore" | string;
  principalArn: string;
  allowedActions: string[];
  allowedResources: string[];
  clockSkewSeconds?: number;
}

export interface ForwardedOAuthTokenConfig {
  enabled: boolean;
  headerName: string;
  required?: boolean;
  validateAsUserContext?: boolean;
  description?: string;
}

export interface InboundAuthConfig {
  mode: AuthMode;
  allowedIssuers?: string[];
  allowedAudiences?: string[];
  allowedClients?: string[];
  allowedScopes?: string[];
  requiredClaims?: Record<string, string | number | boolean>;
  sigv4?: SigV4AuthConfig;
  forwardedOAuthToken?: ForwardedOAuthTokenConfig;
}

export interface TokenValidationResult {
  signatureValid: boolean;
  issuerValid: boolean;
  audienceValid: boolean;
  clientValid: boolean;
  scopesValid: boolean;
  expiryValid: boolean;
  customClaimsValid: boolean;
  cnfValid?: boolean;
  errors: string[];
}

export interface SigV4ValidationResult {
  signatureValid: boolean;
  credentialScopeValid: boolean;
  regionValid: boolean;
  serviceValid: boolean;
  clockSkewValid: boolean;
  signedHeadersValid: boolean;
  principalAllowed: boolean;
  actionAllowed: boolean;
  resourceAllowed: boolean;
  principalArn: string;
  action: string;
  resource: string;
  region: string;
  service: string;
  signedHeaders: string[];
  canonicalRequest: string;
  stringToSign: string;
  credentialScope: string;
  errors: string[];
}

export type TokenKind =
  | "user-delegated"
  | "autonomous"
  | "obo"
  | "api-key"
  | "workload"
  | "forwarded-user-context";

export interface TokenArtifact {
  compact?: string;
  label?: string;
  header?: object;
  claims?: Record<string, unknown>;
  validation?: TokenValidationResult;
  kind?: TokenKind;
  boundActor?: string;
  boundSubject?: string;
  downstreamAudience?: string;
  resource?: string | string[];
  authorizationDetails?: TokenAuthorizationDetail[];
}
