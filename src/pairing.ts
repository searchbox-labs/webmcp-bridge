export const PAIRING_PROTOCOL_VERSION = 1 as const;
export const PAIRING_CONTEXT = "webmcp-bridge-pairing-v1" as const;

export type RuntimeIdentity = {
  runtime_id: string;
  runtime_handle: string;
  runtime_signing_public_key: string;
  runtime_encryption_public_key: string;
};

export type PairingTranscript = RuntimeIdentity & {
  context: typeof PAIRING_CONTEXT;
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  page_origin: string;
  application_origin: string;
  browser_public_key: string;
  browser_nonce: string;
  runtime_nonce: string;
  credential_id: string;
  requested_scopes: string[];
  issued_at_ms: number;
  expires_at_ms: number;
};

export type RegisterRuntimeMessage = RuntimeIdentity & {
  type: "REGISTER_RUNTIME";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  connection_nonce: string;
  issued_at_ms: number;
  runtime_signature: string;
};

export type RuntimeRegistrationProof = RuntimeIdentity & {
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  connection_nonce: string;
  issued_at_ms: number;
};

export type RequestRegistrationCodeMessage = {
  type: "REQUEST_REGISTRATION_CODE";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  registration_ticket: unknown;
};

export type PairRequestMessage = {
  type: "PAIR_REQUEST";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  runtime_handle: string;
  session_id: string;
  page_origin: string;
  application_origin: string;
  browser_public_key: string;
  browser_nonce: string;
  requested_scopes: string[];
  issued_at_ms: number;
};

export type PairChallengeMessage = {
  type: "PAIR_CHALLENGE";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  transcript: PairingTranscript;
  challenge: string;
  runtime_signature: string;
};

export type SerializedWebAuthnAssertion = {
  credential_id: string;
  authenticator_data: string;
  client_data_json: string;
  signature: string;
  user_handle?: string;
};

export type PairAssertionMessage = {
  type: "PAIR_ASSERTION";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  transcript_hash: string;
  assertion: SerializedWebAuthnAssertion;
};

export type PairAcceptedMessage = RuntimeIdentity & {
  type: "PAIR_ACCEPTED";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  transcript_hash: string;
  browser_public_key: string;
  authorized_scopes: string[];
  issued_at_ms: number;
  expires_at_ms: number;
  runtime_signature: string;
};

export type PairRejectedMessage = {
  type: "PAIR_REJECTED";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  code: string;
  reason: string;
};

export type RuntimeOfflineMessage = {
  type: "RUNTIME_OFFLINE";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  runtime_handle: string;
};

export type PairingMessage =
  | RegisterRuntimeMessage
  | RequestRegistrationCodeMessage
  | PairRequestMessage
  | PairChallengeMessage
  | PairAssertionMessage
  | PairAcceptedMessage
  | PairRejectedMessage
  | RuntimeOfflineMessage;

export type PairAcceptedProof = RuntimeIdentity & {
  type: "PAIR_ACCEPTED";
  protocol_version: typeof PAIRING_PROTOCOL_VERSION;
  request_id: string;
  session_id: string;
  transcript_hash: string;
  browser_public_key: string;
  authorized_scopes: string[];
  issued_at_ms: number;
  expires_at_ms: number;
};

const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;
// Runtime handles are commonly base64url SHA-256 identities, so `_` and `-`
// are valid at either edge. Dots remain allowed only between components.
const handlePattern = /^[A-Za-z0-9_-](?:[A-Za-z0-9_.-]{1,62}[A-Za-z0-9_-])?$/;
const scopePattern = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+)*$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isHandle(value: unknown): value is string {
  return typeof value === "string" && value.length >= 3 && value.length <= 64 && handlePattern.test(value);
}

function isBase64Url(value: unknown, minimumLength = 16, maximumLength = 4096): value is string {
  return typeof value === "string" &&
    value.length >= minimumLength &&
    value.length <= maximumLength &&
    base64UrlPattern.test(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.origin === value &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")));
  } catch {
    return false;
  }
}

function isScopes(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  if (!value.every((scope) => typeof scope === "string" && scope.length <= 128 && scopePattern.test(scope))) {
    return false;
  }
  return value.every((scope, index) => index === 0 || value[index - 1]! < scope);
}

function hasRuntimeIdentity(value: Record<string, unknown>): boolean {
  return isIdentifier(value.runtime_id) &&
    isHandle(value.runtime_handle) &&
    isBase64Url(value.runtime_signing_public_key, 32, 512) &&
    isBase64Url(value.runtime_encryption_public_key, 32, 512);
}

function isPairAcceptedProof(value: unknown): value is PairAcceptedProof {
  if (!isObject(value) || !hasRuntimeIdentity(value)) return false;
  return hasExactKeys(value, [
    "type",
    "protocol_version",
    "request_id",
    "session_id",
    "transcript_hash",
    "runtime_id",
    "runtime_handle",
    "runtime_signing_public_key",
    "runtime_encryption_public_key",
    "browser_public_key",
    "authorized_scopes",
    "issued_at_ms",
    "expires_at_ms",
  ]) && value.type === "PAIR_ACCEPTED" &&
    value.protocol_version === PAIRING_PROTOCOL_VERSION &&
    isIdentifier(value.request_id) &&
    isIdentifier(value.session_id) &&
    isBase64Url(value.transcript_hash, 43, 43) &&
    isBase64Url(value.browser_public_key, 32, 512) &&
    isScopes(value.authorized_scopes) &&
    isTimestamp(value.issued_at_ms) &&
    isTimestamp(value.expires_at_ms) &&
    value.expires_at_ms > value.issued_at_ms;
}

export function isPairingTranscript(value: unknown): value is PairingTranscript {
  if (!isObject(value) || !hasRuntimeIdentity(value)) return false;
  return hasExactKeys(value, [
    "context", "protocol_version", "request_id", "runtime_id", "runtime_handle",
    "runtime_signing_public_key", "runtime_encryption_public_key", "session_id",
    "page_origin", "application_origin", "browser_public_key", "browser_nonce", "runtime_nonce",
    "credential_id", "requested_scopes", "issued_at_ms", "expires_at_ms",
  ]) && value.context === PAIRING_CONTEXT &&
    value.protocol_version === PAIRING_PROTOCOL_VERSION &&
    isIdentifier(value.request_id) &&
    isIdentifier(value.session_id) &&
    isOrigin(value.page_origin) &&
    isOrigin(value.application_origin) &&
    isBase64Url(value.browser_public_key, 32, 512) &&
    isBase64Url(value.browser_nonce) &&
    isBase64Url(value.runtime_nonce) &&
    isBase64Url(value.credential_id) &&
    isScopes(value.requested_scopes) &&
    isTimestamp(value.issued_at_ms) &&
    isTimestamp(value.expires_at_ms) &&
    value.expires_at_ms > value.issued_at_ms;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value).sort().map((key) => {
      const member = value[key];
      if (member === undefined) throw new TypeError("Canonical JSON does not support undefined values.");
      return `${JSON.stringify(key)}:${canonicalize(member)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
}

export function runtimeRegistrationProof(message: RegisterRuntimeMessage): RuntimeRegistrationProof {
  return {
    protocol_version: message.protocol_version,
    runtime_id: message.runtime_id,
    runtime_handle: message.runtime_handle,
    runtime_signing_public_key: message.runtime_signing_public_key,
    runtime_encryption_public_key: message.runtime_encryption_public_key,
    connection_nonce: message.connection_nonce,
    issued_at_ms: message.issued_at_ms,
  };
}

export function serializeRuntimeRegistrationProof(message: RegisterRuntimeMessage): string {
  if (!isPairingMessage(message) || message.type !== "REGISTER_RUNTIME") {
    throw new TypeError("Invalid runtime registration.");
  }
  return canonicalize(runtimeRegistrationProof(message));
}

/** Serializes the exact transcript hashed into the WebAuthn challenge. */
export function serializePairingTranscript(transcript: PairingTranscript): string {
  if (!isPairingTranscript(transcript)) throw new TypeError("Invalid pairing transcript.");
  return canonicalize(transcript);
}

function encodeBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** Returns the base64url SHA-256 value supplied as the WebAuthn challenge. */
export async function hashPairingTranscript(transcript: PairingTranscript): Promise<string> {
  const serialized = new TextEncoder().encode(serializePairingTranscript(transcript));
  return encodeBase64Url(await crypto.subtle.digest("SHA-256", serialized));
}

export async function challengeMatchesTranscript(message: PairChallengeMessage): Promise<boolean> {
  return isPairingMessage(message) && message.type === "PAIR_CHALLENGE" &&
    message.challenge === await hashPairingTranscript(message.transcript);
}

export function pairAcceptedProof(message: PairAcceptedMessage): PairAcceptedProof {
  return {
    type: "PAIR_ACCEPTED",
    protocol_version: message.protocol_version,
    request_id: message.request_id,
    session_id: message.session_id,
    transcript_hash: message.transcript_hash,
    runtime_id: message.runtime_id,
    runtime_handle: message.runtime_handle,
    runtime_signing_public_key: message.runtime_signing_public_key,
    runtime_encryption_public_key: message.runtime_encryption_public_key,
    browser_public_key: message.browser_public_key,
    authorized_scopes: message.authorized_scopes,
    issued_at_ms: message.issued_at_ms,
    expires_at_ms: message.expires_at_ms,
  };
}

export function serializePairAcceptedProof(message: PairAcceptedMessage | PairAcceptedProof): string {
  const proof = "runtime_signature" in message ? pairAcceptedProof(message) : message;
  if (!isPairAcceptedProof(proof)) {
    throw new TypeError("Invalid pairing acceptance.");
  }
  return canonicalize(proof);
}

async function verifyRuntimeSignature(publicKeyBase64Url: string, payload: string, signatureBase64Url: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(decodeBase64Url(publicKeyBase64Url)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    toArrayBuffer(decodeBase64Url(signatureBase64Url)),
    new TextEncoder().encode(payload),
  );
}

export async function verifyPairChallengeSignature(message: PairChallengeMessage): Promise<boolean> {
  if (!isPairingMessage(message) || message.type !== "PAIR_CHALLENGE") return false;
  return verifyRuntimeSignature(
    message.transcript.runtime_signing_public_key,
    serializePairingTranscript(message.transcript),
    message.runtime_signature,
  );
}

export async function verifyPairAcceptedSignature(message: PairAcceptedMessage): Promise<boolean> {
  if (!isPairingMessage(message) || message.type !== "PAIR_ACCEPTED") return false;
  return verifyRuntimeSignature(
    message.runtime_signing_public_key,
    serializePairAcceptedProof(message),
    message.runtime_signature,
  );
}

function isAssertion(value: unknown): value is SerializedWebAuthnAssertion {
  if (!isObject(value)) return false;
  return isBase64Url(value.credential_id) &&
    isBase64Url(value.authenticator_data) &&
    isBase64Url(value.client_data_json) &&
    isBase64Url(value.signature) &&
    (value.user_handle === undefined || isBase64Url(value.user_handle, 1));
}

export function isPairingMessage(value: unknown): value is PairingMessage {
  if (!isObject(value) || value.protocol_version !== PAIRING_PROTOCOL_VERSION) return false;
  switch (value.type) {
    case "REGISTER_RUNTIME":
      return hasRuntimeIdentity(value) && isBase64Url(value.connection_nonce) &&
        isTimestamp(value.issued_at_ms) && isBase64Url(value.runtime_signature);
    case "REQUEST_REGISTRATION_CODE":
      return isObject(value.registration_ticket);
    case "PAIR_REQUEST":
      return isIdentifier(value.request_id) && isHandle(value.runtime_handle) &&
        isIdentifier(value.session_id) && isOrigin(value.page_origin) &&
        isOrigin(value.application_origin) &&
        isBase64Url(value.browser_public_key, 32, 512) && isBase64Url(value.browser_nonce) &&
        isScopes(value.requested_scopes) && isTimestamp(value.issued_at_ms);
    case "PAIR_CHALLENGE":
      return isPairingTranscript(value.transcript) && isBase64Url(value.challenge, 43, 43) &&
        isBase64Url(value.runtime_signature);
    case "PAIR_ASSERTION":
      return isIdentifier(value.request_id) && isIdentifier(value.session_id) &&
        isBase64Url(value.transcript_hash, 43, 43) && isAssertion(value.assertion);
    case "PAIR_ACCEPTED":
      return hasRuntimeIdentity(value) && isIdentifier(value.request_id) &&
        isIdentifier(value.session_id) && isBase64Url(value.transcript_hash, 43, 43) &&
        isBase64Url(value.browser_public_key, 32, 512) && isScopes(value.authorized_scopes) &&
        isTimestamp(value.issued_at_ms) && isTimestamp(value.expires_at_ms) &&
        value.expires_at_ms > value.issued_at_ms && isBase64Url(value.runtime_signature);
    case "PAIR_REJECTED":
      return isIdentifier(value.request_id) && isIdentifier(value.session_id) &&
        isIdentifier(value.code) && typeof value.reason === "string" &&
        value.reason.length > 0 && value.reason.length <= 512;
    case "RUNTIME_OFFLINE":
      return isIdentifier(value.request_id) && isHandle(value.runtime_handle);
    default:
      return false;
  }
}
