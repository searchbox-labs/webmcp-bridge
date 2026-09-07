import assert from "node:assert/strict";
import test from "node:test";
import {
  challengeMatchesTranscript,
  hashPairingTranscript,
  isPairingMessage,
  isPairingTranscript,
  PAIRING_CONTEXT,
  PAIRING_PROTOCOL_VERSION,
  serializePairAcceptedProof,
  serializeRuntimeRegistrationProof,
  serializePairingTranscript,
  verifyPairAcceptedSignature,
  verifyPairChallengeSignature,
  type PairingMessage,
  type PairingTranscript,
} from "../src/pairing.js";

const transcript: PairingTranscript = {
  context: PAIRING_CONTEXT,
  protocol_version: PAIRING_PROTOCOL_VERSION,
  request_id: "request_01",
  runtime_id: "runtime_01",
  runtime_handle: "usih.runtime",
  runtime_signing_public_key: "s".repeat(43),
  runtime_encryption_public_key: "r".repeat(43),
  session_id: "session_01",
  page_origin: "https://pods.example",
  application_origin: "https://app.example",
  browser_public_key: "b".repeat(43),
  browser_nonce: "n".repeat(43),
  runtime_nonce: "q".repeat(43),
  credential_id: "c".repeat(32),
  requested_scopes: ["soundtrack.plan", "spotify.control"],
  issued_at_ms: 1_800_000_000_000,
  expires_at_ms: 1_800_000_120_000,
};

test("canonically serializes a pairing transcript independent of insertion order", () => {
  const reversed = Object.fromEntries(Object.entries(transcript).reverse()) as PairingTranscript;
  const expected = serializePairingTranscript(transcript);
  assert.equal(serializePairingTranscript(reversed), expected);
  assert.equal(JSON.parse(expected).browser_public_key, transcript.browser_public_key);
  assert.equal(isPairingTranscript(JSON.parse(expected)), true);
});

test("binds every security-relevant transcript field into the challenge", async () => {
  const original = await hashPairingTranscript(transcript);
  assert.equal(original.length, 43);

  const mutations: PairingTranscript[] = [
    { ...transcript, browser_public_key: "x".repeat(43) },
    { ...transcript, runtime_id: "runtime_02" },
    { ...transcript, runtime_handle: "other.runtime" },
    { ...transcript, runtime_signing_public_key: "x".repeat(43) },
    { ...transcript, runtime_encryption_public_key: "x".repeat(43) },
    { ...transcript, session_id: "session_02" },
    { ...transcript, page_origin: "https://other.example" },
    { ...transcript, application_origin: "https://other-app.example" },
    { ...transcript, browser_nonce: "x".repeat(43) },
    { ...transcript, runtime_nonce: "x".repeat(43) },
    { ...transcript, credential_id: "x".repeat(32) },
    { ...transcript, requested_scopes: ["soundtrack.plan"] },
    { ...transcript, expires_at_ms: transcript.expires_at_ms + 1 },
  ];
  for (const mutation of mutations) {
    assert.notEqual(await hashPairingTranscript(mutation), original);
  }
});

test("detects a challenge that does not match its transcript", async () => {
  const challenge = await hashPairingTranscript(transcript);
  const message = {
    type: "PAIR_CHALLENGE",
    protocol_version: 1,
    transcript,
    challenge,
    runtime_signature: "s".repeat(86),
  } as const;
  assert.equal(await challengeMatchesTranscript(message), true);
  assert.equal(
    await challengeMatchesTranscript({ ...message, transcript: { ...transcript, session_id: "changed" } }),
    false,
  );
});

test("recognizes all seven pairing message types after JSON serialization", async () => {
  const challenge = await hashPairingTranscript(transcript);
  const messages: PairingMessage[] = [
    {
      type: "REGISTER_RUNTIME",
      protocol_version: 1,
      runtime_id: transcript.runtime_id,
      runtime_handle: transcript.runtime_handle,
      runtime_signing_public_key: transcript.runtime_signing_public_key,
      runtime_encryption_public_key: transcript.runtime_encryption_public_key,
      connection_nonce: "z".repeat(32),
      issued_at_ms: transcript.issued_at_ms,
      runtime_signature: "s".repeat(86),
    },
    {
      type: "PAIR_REQUEST",
      protocol_version: 1,
      request_id: transcript.request_id,
      runtime_handle: transcript.runtime_handle,
      session_id: transcript.session_id,
      page_origin: transcript.page_origin,
      application_origin: transcript.application_origin,
      browser_public_key: transcript.browser_public_key,
      browser_nonce: transcript.browser_nonce,
      requested_scopes: transcript.requested_scopes,
      issued_at_ms: transcript.issued_at_ms,
    },
    {
      type: "PAIR_CHALLENGE",
      protocol_version: 1,
      transcript,
      challenge,
      runtime_signature: "s".repeat(86),
    },
    {
      type: "PAIR_ASSERTION",
      protocol_version: 1,
      request_id: transcript.request_id,
      session_id: transcript.session_id,
      transcript_hash: challenge,
      assertion: {
        credential_id: transcript.credential_id,
        authenticator_data: "a".repeat(48),
        client_data_json: "d".repeat(48),
        signature: "s".repeat(86),
      },
    },
    {
      type: "PAIR_ACCEPTED",
      protocol_version: 1,
      request_id: transcript.request_id,
      session_id: transcript.session_id,
      transcript_hash: challenge,
      runtime_id: transcript.runtime_id,
      runtime_handle: transcript.runtime_handle,
      runtime_signing_public_key: transcript.runtime_signing_public_key,
      runtime_encryption_public_key: transcript.runtime_encryption_public_key,
      browser_public_key: transcript.browser_public_key,
      authorized_scopes: transcript.requested_scopes,
      issued_at_ms: transcript.issued_at_ms,
      expires_at_ms: transcript.expires_at_ms,
      runtime_signature: "s".repeat(86),
    },
    {
      type: "PAIR_REJECTED",
      protocol_version: 1,
      request_id: transcript.request_id,
      session_id: transcript.session_id,
      code: "INVALID_ASSERTION",
      reason: "The runtime rejected the WebAuthn assertion.",
    },
    {
      type: "RUNTIME_OFFLINE",
      protocol_version: 1,
      request_id: transcript.request_id,
      runtime_handle: transcript.runtime_handle,
    },
  ];

  for (const message of messages) {
    assert.equal(isPairingMessage(JSON.parse(JSON.stringify(message))), true, message.type);
  }

  assert.equal(
    serializeRuntimeRegistrationProof(messages[0] as Extract<PairingMessage, { type: "REGISTER_RUNTIME" }>),
    `{"connection_nonce":"${"z".repeat(32)}","issued_at_ms":1800000000000,"protocol_version":1,"runtime_encryption_public_key":"${"r".repeat(43)}","runtime_handle":"usih.runtime","runtime_id":"runtime_01","runtime_signing_public_key":"${"s".repeat(43)}"}`,
  );
});

test("rejects ambiguous transcripts", () => {
  assert.equal(isPairingTranscript({ ...transcript, requested_scopes: ["spotify.control", "soundtrack.plan"] }), false);
  assert.equal(isPairingTranscript({ ...transcript, page_origin: "https://pods.example/path" }), false);
  assert.equal(isPairingTranscript({ ...transcript, expires_at_ms: transcript.issued_at_ms }), false);
  assert.equal(isPairingTranscript({ ...transcript, unexpected_authority: true }), false);
  assert.throws(
    () => serializePairingTranscript({ ...transcript, browser_nonce: "not base64+" }),
    /Invalid pairing transcript/,
  );
});

test("verifies runtime signatures on pairing challenge and acceptance", async () => {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const signingPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
  const signedTranscript = { ...transcript, runtime_signing_public_key: signingPublicKey };
  const challenge = await hashPairingTranscript(signedTranscript);
  const challengePayload = serializePairingTranscript(signedTranscript);
  const challengeSignature = Buffer.from(
    await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(challengePayload)),
  ).toString("base64url");
  const challengeMessage = {
    type: "PAIR_CHALLENGE",
    protocol_version: 1,
    transcript: signedTranscript,
    challenge,
    runtime_signature: challengeSignature,
  } as const;
  assert.equal(await verifyPairChallengeSignature(challengeMessage), true);
  assert.equal(
    await verifyPairChallengeSignature({ ...challengeMessage, challenge: `${challenge.slice(0, -1)}A` }),
    true,
    "signature validation only checks the signature payload",
  );
  assert.equal(
    await challengeMatchesTranscript({ ...challengeMessage, challenge: `${challenge.slice(0, -1)}A` }),
    false,
  );

  const accepted = {
    type: "PAIR_ACCEPTED",
    protocol_version: 1,
    request_id: signedTranscript.request_id,
    session_id: signedTranscript.session_id,
    transcript_hash: challenge,
    runtime_id: signedTranscript.runtime_id,
    runtime_handle: signedTranscript.runtime_handle,
    runtime_signing_public_key: signingPublicKey,
    runtime_encryption_public_key: signedTranscript.runtime_encryption_public_key,
    browser_public_key: signedTranscript.browser_public_key,
    authorized_scopes: signedTranscript.requested_scopes,
    issued_at_ms: signedTranscript.issued_at_ms,
    expires_at_ms: signedTranscript.expires_at_ms,
    runtime_signature: "pending",
  } as const;
  const acceptancePayload = serializePairAcceptedProof(accepted);
  const acceptanceSignature = Buffer.from(
    await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(acceptancePayload)),
  ).toString("base64url");
  assert.equal(await verifyPairAcceptedSignature({ ...accepted, runtime_signature: acceptanceSignature }), true);
  assert.equal(
    await verifyPairAcceptedSignature({ ...accepted, authorized_scopes: ["spotify.control"], runtime_signature: acceptanceSignature }),
    false,
  );
});
