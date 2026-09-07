import assert from "node:assert/strict";
import test from "node:test";
import { ENROLLMENT_CONTEXT, hashEnrollmentTranscript, serializeEnrollmentTranscript, type EnrollmentTranscript } from "../src/enrollment.js";

const transcript: EnrollmentTranscript = {
  context: ENROLLMENT_CONTEXT, protocol_version: 1, request_id: "request_1", session_id: "session_1",
  runtime_id: "runtime_1", runtime_handle: "handle_1", agent_name: "mars_agent",
  runtime_signing_public_key: "k".repeat(43),
  page_origin: "https://pods.example", rp_id: "pods.example", user_id: "u".repeat(43),
  challenge: "c".repeat(43), issued_at_ms: 1_800_000_000_000, expires_at_ms: 1_800_000_120_000,
};

test("enrollment transcript is canonical and binds the agent name", async () => {
  assert.equal(serializeEnrollmentTranscript(Object.fromEntries(Object.entries(transcript).reverse()) as EnrollmentTranscript), serializeEnrollmentTranscript(transcript));
  assert.notEqual(await hashEnrollmentTranscript(transcript), await hashEnrollmentTranscript({ ...transcript, agent_name: "attacker" }));
});

test("enrollment transcript rejects an RP or origin mismatch shape", () => {
  assert.throws(() => serializeEnrollmentTranscript({ ...transcript, page_origin: "http://pods.example" }), /Invalid/);
  assert.throws(() => serializeEnrollmentTranscript({ ...transcript, rp_id: "https://pods.example" }), /Invalid/);
  assert.throws(() => serializeEnrollmentTranscript({ ...transcript, unexpected: true } as EnrollmentTranscript), /Invalid/);
  assert.throws(() => serializeEnrollmentTranscript({ ...transcript, agent_name: "MarsAgent" }), /Invalid/);
});
