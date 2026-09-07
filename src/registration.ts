import { PAIRING_PROTOCOL_VERSION, type RuntimeIdentity } from "./pairing.js";

export const REGISTRATION_PROTOCOL_VERSION = PAIRING_PROTOCOL_VERSION;
export const REGISTRATION_TICKET_CONTEXT = "webmcp-bridge-registration-ticket-v1" as const;

export type RegistrationTicketProof = RuntimeIdentity & {
  context: typeof REGISTRATION_TICKET_CONTEXT;
  protocol_version: typeof REGISTRATION_PROTOCOL_VERSION;
  registration_nonce: string;
  webauthn_challenge: string;
  issued_at_ms: number;
  expires_at_ms: number;
};

/**
 * A self-contained runtime-signed authorization to create one Agent account.
 * A live runtime gives this ticket to the relay, which exposes it only after a
 * short-code exchange. The signature covers every field in
 * `RegistrationTicketProof`.
 */
export type RegistrationTicket = RegistrationTicketProof & {
  type: "REGISTRATION_TICKET";
  runtime_signature: string;
};

export type SerializedWebAuthnRegistration = {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports?: string[];
  };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
};

/** Relay-hosted page -> relay after the user chooses a name and creates a passkey. */
export type RegisterAgentMessage = {
  type: "REGISTER_AGENT";
  protocol_version: typeof REGISTRATION_PROTOCOL_VERSION;
  request_id: string;
  agent_name: string;
  registration_code: string;
  ticket: RegistrationTicket;
  credential: SerializedWebAuthnRegistration;
};

export type RegistrationOptionsMessage = {
  type: "REGISTRATION_OPTIONS";
  protocol_version: typeof REGISTRATION_PROTOCOL_VERSION;
  expires_at_ms: number;
  ticket: RegistrationTicket;
};

/** Relay -> relay-hosted page after the durable Agent-name mapping is stored. */
export type AgentRegisteredMessage = RuntimeIdentity & {
  type: "AGENT_REGISTERED";
  protocol_version: typeof REGISTRATION_PROTOCOL_VERSION;
  request_id: string;
  agent_name: string;
  credential_id: string;
  registered_at_ms: number;
};

export type AgentRegistrationRejectedMessage = {
  type: "AGENT_REGISTRATION_REJECTED";
  protocol_version: typeof REGISTRATION_PROTOCOL_VERSION;
  request_id: string;
  code: string;
  reason: string;
};

export type AgentRegistrationMessage =
  | RegisterAgentMessage
  | RegistrationOptionsMessage
  | AgentRegisteredMessage
  | AgentRegistrationRejectedMessage;

const identifierPattern = /^[A-Za-z0-9_-]{1,128}$/;
const handlePattern = /^[A-Za-z0-9_-](?:[A-Za-z0-9_.-]{1,62}[A-Za-z0-9_-])?$/;
const agentNamePattern = /^[a-z0-9](?:[a-z0-9_.-]{0,62}[a-z0-9])?$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const registrationCodePattern = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

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
  return typeof value === "string" && value.length <= 64 && agentNamePattern.test(value);
}

function isBase64Url(value: unknown, minimumLength = 16, maximumLength = 4096): value is string {
  return typeof value === "string" && value.length >= minimumLength && value.length <= maximumLength &&
    base64UrlPattern.test(value);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function hasRuntimeIdentity(value: Record<string, unknown>): boolean {
  return isIdentifier(value.runtime_id) && isHandle(value.runtime_handle) &&
    isBase64Url(value.runtime_signing_public_key, 43, 43) &&
    isBase64Url(value.runtime_encryption_public_key, 43, 43);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not support non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => {
      const member = value[key];
      if (member === undefined) throw new TypeError("Canonical JSON does not support undefined values.");
      return `${JSON.stringify(key)}:${canonicalize(member)}`;
    }).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
}

export function registrationTicketProof(ticket: RegistrationTicket): RegistrationTicketProof {
  return {
    context: ticket.context,
    protocol_version: ticket.protocol_version,
    runtime_id: ticket.runtime_id,
    runtime_handle: ticket.runtime_handle,
    runtime_signing_public_key: ticket.runtime_signing_public_key,
    runtime_encryption_public_key: ticket.runtime_encryption_public_key,
    registration_nonce: ticket.registration_nonce,
    webauthn_challenge: ticket.webauthn_challenge,
    issued_at_ms: ticket.issued_at_ms,
    expires_at_ms: ticket.expires_at_ms,
  };
}

export function isRegistrationTicketProof(value: unknown): value is RegistrationTicketProof {
  if (!isObject(value) || !hasRuntimeIdentity(value)) return false;
  return hasExactKeys(value, [
    "context", "protocol_version", "runtime_id", "runtime_handle", "runtime_signing_public_key",
    "runtime_encryption_public_key", "registration_nonce", "webauthn_challenge", "issued_at_ms",
    "expires_at_ms",
  ]) && value.context === REGISTRATION_TICKET_CONTEXT &&
    value.protocol_version === REGISTRATION_PROTOCOL_VERSION && isBase64Url(value.registration_nonce, 32, 128) &&
    isBase64Url(value.webauthn_challenge, 43, 128) && isTimestamp(value.issued_at_ms) &&
    isTimestamp(value.expires_at_ms) && value.expires_at_ms > value.issued_at_ms;
}

export function isRegistrationTicket(value: unknown): value is RegistrationTicket {
  if (!isObject(value) || !hasRuntimeIdentity(value)) return false;
  return hasExactKeys(value, [
    "type", "context", "protocol_version", "runtime_id", "runtime_handle",
    "runtime_signing_public_key", "runtime_encryption_public_key", "registration_nonce",
    "webauthn_challenge", "issued_at_ms", "expires_at_ms", "runtime_signature",
  ]) && value.type === "REGISTRATION_TICKET" && value.context === REGISTRATION_TICKET_CONTEXT &&
    value.protocol_version === REGISTRATION_PROTOCOL_VERSION && isBase64Url(value.registration_nonce, 32, 128) &&
    isBase64Url(value.webauthn_challenge, 43, 128) && isTimestamp(value.issued_at_ms) &&
    isTimestamp(value.expires_at_ms) && value.expires_at_ms > value.issued_at_ms &&
    isBase64Url(value.runtime_signature, 86, 86);
}

export function serializeRegistrationTicketProof(ticket: RegistrationTicket | RegistrationTicketProof): string {
  const proof = "runtime_signature" in ticket ? registrationTicketProof(ticket) : ticket;
  if (!isRegistrationTicketProof(proof)) throw new TypeError("Invalid registration ticket proof.");
  return canonicalize(proof);
}

export function registrationTicketIsCurrent(ticket: RegistrationTicket, now = Date.now()): boolean {
  return isRegistrationTicket(ticket) && ticket.issued_at_ms <= now && now < ticket.expires_at_ms;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Verifies ticket shape, lifetime, runtime identity derivation, and Ed25519 signature. */
export async function verifyRegistrationTicket(ticket: RegistrationTicket, now = Date.now()): Promise<boolean> {
  if (!registrationTicketIsCurrent(ticket, now)) return false;
  try {
    const signingKeyBytes = decodeBase64Url(ticket.runtime_signing_public_key);
    const identityDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", signingKeyBytes));
    const expectedIdentity = encodeBase64Url(identityDigest);
    if (ticket.runtime_id !== expectedIdentity || ticket.runtime_handle !== expectedIdentity) return false;
    const publicKey = await crypto.subtle.importKey("raw", signingKeyBytes, "Ed25519", false, ["verify"]);
    return crypto.subtle.verify(
      "Ed25519",
      publicKey,
      decodeBase64Url(ticket.runtime_signature),
      new TextEncoder().encode(serializeRegistrationTicketProof(ticket)),
    );
  } catch {
    return false;
  }
}

export function encodeRegistrationTicket(ticket: RegistrationTicket): string {
  if (!isRegistrationTicket(ticket)) throw new TypeError("Invalid registration ticket.");
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(ticket)));
}

export function decodeRegistrationTicket(encoded: string): RegistrationTicket {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
  } catch {
    throw new TypeError("Invalid encoded registration ticket.");
  }
  if (!isRegistrationTicket(value)) throw new TypeError("Invalid encoded registration ticket.");
  return value;
}

function isCredential(value: unknown): value is SerializedWebAuthnRegistration {
  if (!isObject(value) || !isObject(value.response) || !isObject(value.clientExtensionResults)) return false;
  const transports = value.response.transports;
  return isBase64Url(value.id) && value.rawId === value.id && value.type === "public-key" &&
    isBase64Url(value.response.attestationObject) && isBase64Url(value.response.clientDataJSON) &&
    (transports === undefined || (Array.isArray(transports) && transports.length <= 16 &&
      transports.every((transport) => typeof transport === "string" && transport.length <= 64))) &&
    (value.authenticatorAttachment === undefined || typeof value.authenticatorAttachment === "string");
}

export function isAgentRegistrationMessage(value: unknown): value is AgentRegistrationMessage {
  if (!isObject(value) || value.protocol_version !== REGISTRATION_PROTOCOL_VERSION) return false;
  switch (value.type) {
    case "REGISTER_AGENT":
      return hasExactKeys(value, ["type", "protocol_version", "request_id", "agent_name", "registration_code", "ticket", "credential"]) &&
        isIdentifier(value.request_id) && isAgentName(value.agent_name) &&
        typeof value.registration_code === "string" && registrationCodePattern.test(value.registration_code) &&
        isRegistrationTicket(value.ticket) && isCredential(value.credential);
    case "REGISTRATION_OPTIONS":
      return hasExactKeys(value, ["type", "protocol_version", "expires_at_ms", "ticket"]) &&
        isTimestamp(value.expires_at_ms) && isRegistrationTicket(value.ticket);
    case "AGENT_REGISTERED":
      return hasExactKeys(value, [
        "type", "protocol_version", "request_id", "agent_name", "runtime_id", "runtime_handle",
        "runtime_signing_public_key", "runtime_encryption_public_key", "credential_id", "registered_at_ms",
      ]) && isIdentifier(value.request_id) && isAgentName(value.agent_name) && hasRuntimeIdentity(value) &&
        isBase64Url(value.credential_id) && isTimestamp(value.registered_at_ms);
    case "AGENT_REGISTRATION_REJECTED":
      return hasExactKeys(value, ["type", "protocol_version", "request_id", "code", "reason"]) &&
        isIdentifier(value.request_id) && isIdentifier(value.code) && typeof value.reason === "string" &&
        value.reason.length > 0 && value.reason.length <= 512;
    default:
      return false;
  }
}
