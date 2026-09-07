import { PAIRING_PROTOCOL_VERSION } from "./pairing.js";

export const ENROLLMENT_CONTEXT = "webmcp-bridge-enrollment-v1" as const;
export const ENROLLMENT_PROTOCOL_VERSION = PAIRING_PROTOCOL_VERSION;

export type EnrollmentTranscript = {
  context: typeof ENROLLMENT_CONTEXT;
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  runtime_id: string;
  runtime_handle: string;
  runtime_signing_public_key: string;
  agent_name: string;
  page_origin: string;
  rp_id: string;
  user_id: string;
  challenge: string;
  issued_at_ms: number;
  expires_at_ms: number;
};

export type EnrollRequest = {
  type: "ENROLL_REQUEST";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  runtime_handle: string;
  agent_name: string;
  page_origin: string;
};

export type EnrollChallenge = {
  type: "ENROLL_CHALLENGE";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  transcript: EnrollmentTranscript;
  options: Record<string, unknown>;
  runtime_signature: string;
};

export type EnrollResponse = {
  type: "ENROLL_RESPONSE";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  response: Record<string, unknown>;
};

export type EnrollAccepted = {
  type: "ENROLL_ACCEPTED";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  runtime_handle: string;
  credential_id: string;
};

export type EnrollRejected = {
  type: "ENROLL_REJECTED";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  code: string;
  reason: string;
};

export type ClaimAgentName = {
  type: "CLAIM_AGENT_NAME";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  runtime_id: string;
  runtime_handle: string;
  agent_name: string;
  credential_id: string;
  credential_public_key: string;
  enrollment_hash: string;
  connection_nonce: string;
  issued_at_ms: number;
  runtime_signature: string;
};

export type AgentNameClaimed = {
  type: "AGENT_NAME_CLAIMED";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  runtime_id: string;
  runtime_handle: string;
  agent_name: string;
  credential_id: string;
  enrollment_hash: string;
  connection_nonce: string;
};

export type ResolveAgentName = {
  type: "RESOLVE_AGENT_NAME";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  agent_name: string;
};

export type AgentNameResolution = {
  type: "AGENT_NAME_RESOLUTION";
  protocol_version: typeof ENROLLMENT_PROTOCOL_VERSION;
  agent_name: string;
  found: boolean;
  online: boolean;
  runtime_id?: string;
  runtime_handle?: string;
};

export type EnrollmentMessage = EnrollRequest | EnrollChallenge | EnrollResponse | EnrollAccepted |
  EnrollRejected | ClaimAgentName | AgentNameClaimed | ResolveAgentName | AgentNameResolution;

const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;
const handlePattern = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{1,62}[A-Za-z0-9])?$/;
const agentNamePattern = /^[a-z0-9](?:[a-z0-9_.-]{0,62}[a-z0-9])?$/;
const rpIdPattern = /^(?=.{1,253}$)(?:localhost|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isHandle(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 64 && handlePattern.test(value);
}

function isAgentName(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && agentNamePattern.test(value);
}

function isBase64Url(value: unknown, minimumLength = 16, maximumLength = 4096): value is string {
  return typeof value === "string" && value.length >= minimumLength && value.length <= maximumLength && base64UrlPattern.test(value);
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" ||
      (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")));
  } catch {
    return false;
  }
}

export function isEnrollmentTranscript(value: unknown): value is EnrollmentTranscript {
  if (!isObject(value)) return false;
  return hasExactKeys(value, [
    "context", "protocol_version", "request_id", "session_id", "runtime_id", "runtime_handle",
    "runtime_signing_public_key", "agent_name", "page_origin", "rp_id", "user_id", "challenge",
    "issued_at_ms", "expires_at_ms",
  ]) && value.context === ENROLLMENT_CONTEXT && value.protocol_version === ENROLLMENT_PROTOCOL_VERSION &&
    isIdentifier(value.request_id) && isIdentifier(value.session_id) && isIdentifier(value.runtime_id) &&
    isHandle(value.runtime_handle) && isBase64Url(value.runtime_signing_public_key, 43, 43) &&
    isAgentName(value.agent_name) && isOrigin(value.page_origin) &&
    typeof value.rp_id === "string" && rpIdPattern.test(value.rp_id) && isBase64Url(value.user_id) &&
    isBase64Url(value.challenge, 43, 43) && Number.isSafeInteger(value.issued_at_ms) &&
    Number.isSafeInteger(value.expires_at_ms) && (value.issued_at_ms as number) > 0 &&
    (value.expires_at_ms as number) > (value.issued_at_ms as number);
}

export function isEnrollmentMessage(value: unknown): value is EnrollmentMessage {
  if (!isObject(value) || value.protocol_version !== ENROLLMENT_PROTOCOL_VERSION) return false;
  switch (value.type) {
    case "ENROLL_REQUEST":
      return isIdentifier(value.request_id) && isIdentifier(value.session_id) && isHandle(value.runtime_handle) &&
        isAgentName(value.agent_name) && isOrigin(value.page_origin);
    case "ENROLL_CHALLENGE":
      return isEnrollmentTranscript(value.transcript) && isObject(value.options) && isBase64Url(value.runtime_signature);
    case "ENROLL_RESPONSE":
      return isIdentifier(value.request_id) && isIdentifier(value.session_id) && isObject(value.response);
    case "ENROLL_ACCEPTED":
      return isIdentifier(value.request_id) && isIdentifier(value.session_id) && isHandle(value.runtime_handle) &&
        isBase64Url(value.credential_id);
    case "ENROLL_REJECTED":
      return isIdentifier(value.request_id) && isIdentifier(value.session_id) && isIdentifier(value.code) &&
        typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 512;
    case "CLAIM_AGENT_NAME":
      return isIdentifier(value.runtime_id) && isHandle(value.runtime_handle) && isAgentName(value.agent_name) &&
        isBase64Url(value.credential_id) && isBase64Url(value.credential_public_key, 16, 4096) &&
        isBase64Url(value.enrollment_hash, 43, 43) && isBase64Url(value.connection_nonce) &&
        Number.isSafeInteger(value.issued_at_ms) && (value.issued_at_ms as number) > 0 && isBase64Url(value.runtime_signature);
    case "AGENT_NAME_CLAIMED":
      return isIdentifier(value.runtime_id) && isHandle(value.runtime_handle) && isAgentName(value.agent_name) &&
        isBase64Url(value.credential_id) && isBase64Url(value.enrollment_hash, 43, 43) && isBase64Url(value.connection_nonce);
    case "RESOLVE_AGENT_NAME":
      return isAgentName(value.agent_name);
    case "AGENT_NAME_RESOLUTION":
      return isAgentName(value.agent_name) && typeof value.found === "boolean" && typeof value.online === "boolean" &&
        (value.runtime_id === undefined || isIdentifier(value.runtime_id)) &&
        (value.runtime_handle === undefined || isHandle(value.runtime_handle)) &&
        (!value.found || (isIdentifier(value.runtime_id) && isHandle(value.runtime_handle)));
    default:
      return false;
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, member]) => {
    if (member === undefined) throw new TypeError("Canonical JSON does not support undefined values.");
    return `${JSON.stringify(key)}:${canonical(member)}`;
  }).join(",")}}`;
  throw new TypeError("Unsupported canonical value.");
}

export function serializeEnrollmentTranscript(value: EnrollmentTranscript): string {
  if (!isEnrollmentTranscript(value)) throw new TypeError("Invalid enrollment transcript.");
  return canonical(value);
}

export function serializeAgentNameClaim(value: ClaimAgentName): string {
  const { type: _type, runtime_signature: _signature, ...proof } = value;
  return canonical(proof);
}

export async function hashEnrollmentTranscript(value: EnrollmentTranscript): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeEnrollmentTranscript(value)));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
