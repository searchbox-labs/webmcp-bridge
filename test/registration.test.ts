import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeRegistrationTicket,
  encodeRegistrationTicket,
  isAgentRegistrationMessage,
  isRegistrationTicket,
  registrationTicketIsCurrent,
  REGISTRATION_TICKET_CONTEXT,
  serializeRegistrationTicketProof,
  verifyRegistrationTicket,
  type AgentRegistrationMessage,
  type RegistrationTicket,
  type RegistrationTicketProof,
} from "../src/registration.js";

const b64 = (value: Uint8Array): string => Buffer.from(value).toString("base64url");

async function fixture(): Promise<{ ticket: RegistrationTicket; privateKey: CryptoKey }> {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const signingPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const runtimeId = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", signingPublicKey)));
  const proof: RegistrationTicketProof = {
    context: REGISTRATION_TICKET_CONTEXT,
    protocol_version: 1,
    runtime_id: runtimeId,
    runtime_handle: runtimeId,
    runtime_signing_public_key: b64(signingPublicKey),
    runtime_encryption_public_key: b64(crypto.getRandomValues(new Uint8Array(32))),
    registration_nonce: b64(crypto.getRandomValues(new Uint8Array(32))),
    webauthn_challenge: b64(crypto.getRandomValues(new Uint8Array(32))),
    issued_at_ms: 1_800_000_000_000,
    expires_at_ms: 1_800_000_600_000,
  };
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keys.privateKey,
    new TextEncoder().encode(serializeRegistrationTicketProof(proof)),
  );
  return {
    ticket: { type: "REGISTRATION_TICKET", ...proof, runtime_signature: b64(new Uint8Array(signature)) },
    privateKey: keys.privateKey,
  };
}

test("canonically serializes every signed registration-ticket field", async () => {
  const { ticket } = await fixture();
  const proof = serializeRegistrationTicketProof(ticket);
  const reversed = Object.fromEntries(Object.entries(JSON.parse(proof)).reverse()) as RegistrationTicketProof;
  assert.equal(serializeRegistrationTicketProof(reversed), proof);
  const parsed = JSON.parse(proof) as Record<string, unknown>;
  assert.equal(parsed.registration_nonce, ticket.registration_nonce);
  assert.equal(parsed.webauthn_challenge, ticket.webauthn_challenge);
  assert.equal(parsed.runtime_encryption_public_key, ticket.runtime_encryption_public_key);
  assert.equal(parsed.runtime_signature, undefined);
});

test("verifies a current ticket and rejects expiry, future issue time, and identity mismatch", async () => {
  const { ticket } = await fixture();
  assert.equal(isRegistrationTicket(ticket), true);
  assert.equal(registrationTicketIsCurrent(ticket, ticket.issued_at_ms), true);
  assert.equal(await verifyRegistrationTicket(ticket, ticket.issued_at_ms + 1), true);
  assert.equal(await verifyRegistrationTicket(ticket, ticket.expires_at_ms), false);
  assert.equal(await verifyRegistrationTicket(ticket, ticket.issued_at_ms - 1), false);
  assert.equal(await verifyRegistrationTicket({ ...ticket, runtime_id: "attacker" }, ticket.issued_at_ms + 1), false);
});

test("rejects tampering with every field covered by the runtime signature", async () => {
  const { ticket } = await fixture();
  const now = ticket.issued_at_ms + 1;
  const mutations: RegistrationTicket[] = [
    { ...ticket, runtime_encryption_public_key: "x".repeat(43) },
    { ...ticket, registration_nonce: "x".repeat(43) },
    { ...ticket, webauthn_challenge: "x".repeat(43) },
    { ...ticket, issued_at_ms: ticket.issued_at_ms + 1 },
    { ...ticket, expires_at_ms: ticket.expires_at_ms + 1 },
  ];
  for (const mutation of mutations) assert.equal(await verifyRegistrationTicket(mutation, now), false);

  const changedSignature = `${ticket.runtime_signature[0] === "A" ? "B" : "A"}${ticket.runtime_signature.slice(1)}`;
  assert.equal(await verifyRegistrationTicket({ ...ticket, runtime_signature: changedSignature }, now), false);
});

test("round-trips a registration ticket through a URL-safe value", async () => {
  const { ticket } = await fixture();
  const encoded = encodeRegistrationTicket(ticket);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeRegistrationTicket(encoded), ticket);
  assert.throws(() => decodeRegistrationTicket("not-json"), /Invalid encoded registration ticket/);
});

test("validates relay-hosted Agent registration request and responses", async () => {
  const { ticket } = await fixture();
  const messages: AgentRegistrationMessage[] = [
    {
      type: "REGISTER_AGENT",
      protocol_version: 1,
      request_id: "register_01",
      agent_name: "pods_agent",
      registration_code: "ABCD-EFGH",
      ticket,
      credential: {
        id: "c".repeat(32),
        rawId: "c".repeat(32),
        type: "public-key",
        response: { attestationObject: "a".repeat(64), clientDataJSON: "d".repeat(64), transports: ["internal"] },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      },
    },
    {
      type: "REGISTRATION_OPTIONS",
      protocol_version: 1,
      expires_at_ms: ticket.expires_at_ms,
      ticket,
    },
    {
      type: "AGENT_REGISTERED",
      protocol_version: 1,
      request_id: "register_01",
      agent_name: "pods_agent",
      runtime_id: ticket.runtime_id,
      runtime_handle: ticket.runtime_handle,
      runtime_signing_public_key: ticket.runtime_signing_public_key,
      runtime_encryption_public_key: ticket.runtime_encryption_public_key,
      credential_id: "c".repeat(32),
      registered_at_ms: ticket.issued_at_ms,
    },
    {
      type: "AGENT_REGISTRATION_REJECTED",
      protocol_version: 1,
      request_id: "register_01",
      code: "AGENT_NAME_TAKEN",
      reason: "That Agent name is already registered.",
    },
  ];
  for (const message of messages) {
    assert.equal(isAgentRegistrationMessage(JSON.parse(JSON.stringify(message))), true, message.type);
  }
  assert.equal(isAgentRegistrationMessage({ ...messages[0], agent_name: "UpperCase" }), false);
  assert.equal(isAgentRegistrationMessage({ ...messages[0], unexpected: true }), false);
});
