# WebMCP Bridge

WebMCP Bridge projects a web page's live WebMCP tool surface to an external
agent runtime while keeping final tool-execution authority inside the browser.

The agent can reason over the tools currently exposed by the page and request
an invocation. It does not receive DOM access, JavaScript execution, browser
automation, or unrestricted machine access. The page validates the request and
executes the actual WebMCP tool through `document.modelContext`.

```text
User intent
    ↓
External agent runtime
    ↓  live tools + structured INVOKE
Bridge transport
    ↓
Page bridge
    ↓  document.modelContext.executeTool(...)
WebMCP-enabled application
```

The SDK is independent of agent frameworks, UI frameworks, relay providers,
and native runtimes. A TypeScript, JavaScript, Zig, Python, or Rust agent host
can use the protocol as long as it can communicate through a compatible
transport.

> **Security status:** the SDK now includes runtime-signed registration,
> passkey owner authentication, app-origin-bound pairing, and optional
> end-to-end encryption. The raw transports remain low-level building blocks:
> using one without the pairing and encryption layers is appropriate only for
> local development or another independently secured environment. See
> [Production trust model](#production-trust-model).

## Why this exists

WebMCP gives a page a structured capability surface. WebMCP Bridge lets an
agent outside the immediate browser context use that same surface without
replacing or bypassing WebMCP.

The responsibilities remain separate:

- **WebMCP application:** defines which semantic operations exist.
- **External agent:** translates user intent into one of those operations.
- **Transport:** carries tool manifests, invocation requests, and results.
- **Page bridge:** checks current page state and invokes the real WebMCP tool.

If the page does not expose a capability, the bridge cannot create it. If the
page adds or removes tools, the agent's actionable tool surface changes with it.

## Install

```sh
npm install @searchboxlabs/webmcp-bridge
```

Available entry points:

- `@searchboxlabs/webmcp-bridge/page`
- `@searchboxlabs/webmcp-bridge/agent`
- `@searchboxlabs/webmcp-bridge/encryption`
- `@searchboxlabs/webmcp-bridge/enrollment`
- `@searchboxlabs/webmcp-bridge/pairing`
- `@searchboxlabs/webmcp-bridge/protocol`
- `@searchboxlabs/webmcp-bridge/registration`
- `@searchboxlabs/webmcp-bridge/transport`

## End-to-end encryption

Version 0.4 includes an encrypted transport wrapper. Each endpoint generates an
X25519 keypair, receives its paired peer's certified public key, and wraps its
relay transport before starting the page or agent bridge:

```ts
import {
  createEncryptedTransport,
  createWebSocketTransport,
  generateSessionKeyPair,
} from "@searchboxlabs/webmcp-bridge";

const keys = await generateSessionKeyPair();
// Send keys.publicKey through the authenticated pairing flow. The private key
// is non-exportable and remains in this browser or agent process.

const relay = createWebSocketTransport({
  url: "wss://relay.example/v1/ws",
  sessionId,
  source: "page",
  token: phase1RelayToken,
});

const transport = await createEncryptedTransport({
  transport: relay,
  sessionId,
  source: "page",
  privateKey: keys.privateKey,
  peerPublicKey: certifiedAgentPublicKey,
});
```

The wrapper uses X25519 key agreement, HKDF-SHA-256 directional keys, and
AES-256-GCM authenticated encryption. The relay can still enforce the outer
`TOOLS`, `INVOKE`, `RESULT`, or `ERROR` direction, but cannot read tool names,
schemas, invocation arguments, results, or errors. Session and encryption
metadata are authenticated as additional data, and sender-instance sequence
numbers reject replayed ciphertext.

Public-key certification and delivery belong to the authenticated pairing
service. Never accept an unverified peer public key from the relay or URL.

## Live-runtime Agent registration protocol

The `@searchboxlabs/webmcp-bridge/registration` entry point defines the
runtime-signed ticket and short-code messages used to create an Agent account
through a relay-hosted page while the intended runtime is online.

```text
REGISTER_RUNTIME + REGISTRATION_TICKET
        ↓
ABCD-EFGH
        ↓
REGISTRATION_OPTIONS
        ↓
REGISTER_AGENT
        ↓
AGENT_REGISTERED | AGENT_REGISTRATION_REJECTED
```

The ticket binds the runtime ID, runtime handle, Ed25519 signing public key,
X25519 encryption public key, a single-use registration nonce, the WebAuthn
enrollment challenge, issue time, and expiry. Its `runtime_signature` covers a
canonical serialization of all those fields.

`verifyRegistrationTicket()` checks the ticket lifetime, derives the expected
runtime identity from its signing public key, and verifies the Ed25519
signature. The ticket is delivered over the authenticated live runtime
connection—not placed in the registration URL.

The relay returns a five-minute, single-use code to the runtime. The user enters
that code and an Agent name at `/register`; the relay returns the bound WebAuthn
options only while the runtime remains connected. After passkey creation, the
page submits `REGISTER_AGENT`. The relay returns either `AGENT_REGISTERED` or a
request-correlated `AGENT_REGISTRATION_REJECTED`. The registration ticket is
proof of runtime identity, while the code proves this ceremony was initiated
for the currently connected runtime.

The relay also returns the original registration ticket, WebAuthn client data,
and attestation evidence to the runtime. The runtime independently verifies the
ceremony and checks that the resulting public credential matches the stored
record. A conflicting newer owner is held pending until the runtime operator
explicitly approves replacement locally.

## Pairing protocol

The exported `@searchboxlabs/webmcp-bridge/pairing` entry point defines the
seven messages shared by pages, relays, and runtimes:

```text
REGISTER_RUNTIME
PAIR_REQUEST
PAIR_CHALLENGE
PAIR_ASSERTION
PAIR_ACCEPTED
PAIR_REJECTED
RUNTIME_OFFLINE
```

`PAIR_CHALLENGE` carries one canonical transcript containing the runtime ID,
public handle, signing and encryption public keys, browser public key, passkey
credential ID, session ID, relay authentication origin, destination application
origin, browser and runtime nonces, requested scopes, and validity window.
`hashPairingTranscript()` produces the base64url
SHA-256 value used as the WebAuthn challenge. Changing any bound field changes
the challenge.

Scopes must be sorted and unique. Origins must be exact HTTPS origins, except
for HTTP loopback origins during local development. Unknown transcript fields,
invalid identifiers, malformed base64url values, and invalid validity windows
are rejected before canonicalization.

`serializeRuntimeRegistrationProof()` produces the exact UTF-8 payload a
runtime signs for `REGISTER_RUNTIME`. The proof binds the runtime ID, public
handle, Ed25519 signing key, X25519 encryption key, fresh connection nonce, and
issue time. Relays can verify key possession without becoming the owner of the
runtime identity.

Live `REGISTER_RUNTIME` presence is separate from permanent Agent-account
registration. A human-readable Agent name is created through the signed,
short-code registration flow. Later, a runtime proves possession of the same
signing key when it connects, and the relay can report that registered
Agent as online or offline without deleting its account mapping.

## Page-side usage

Register the application's WebMCP tools normally, create a page transport, and
start the bridge with the page's `document.modelContext`.

```ts
import {
  createWebSocketTransport,
  startPageBridge,
  type WebMcpModelContext,
} from "@searchboxlabs/webmcp-bridge";

const sessionId = new URL(location.href).searchParams.get("session")!;
const token = new URLSearchParams(location.hash.slice(1)).get("token")!;

const transport = createWebSocketTransport({
  url: "wss://relay-webmcpbridge.searchboxlabs.org/v1/ws",
  sessionId,
  source: "page",
  token,
});

const stop = await startPageBridge({
  modelContext: document.modelContext as WebMcpModelContext,
  transport,
  onStatus(status) {
    console.log("Bridge status", status);
  },
});

// Call when the page or component is disposed.
// stop();
```

At startup, the page bridge:

1. Calls `modelContext.getTools()`.
2. Publishes a versioned `TOOLS` manifest.
3. Watches the WebMCP `toolchange` event and republishes changed manifests.
4. Receives structured `INVOKE` requests.
5. Rejects stale toolset versions or unavailable tools.
6. Calls `modelContext.executeTool(...)` inside the browser.
7. Returns a `RESULT` or `ERROR` message.

The page bridge is deterministic infrastructure, not a second agent or LLM.

## Agent-side usage

The agent side receives the live tool manifest and invokes only tools advertised
by the page.

```ts
import {
  connectAgentBridge,
  createWebSocketTransport,
} from "@searchboxlabs/webmcp-bridge";

const transport = createWebSocketTransport({
  url: "wss://relay-webmcpbridge.searchboxlabs.org/v1/ws",
  sessionId: "abc123",
  source: "agent",
  token: process.env.WEBMCP_BRIDGE_SESSION_TOKEN!,
});

const bridge = await connectAgentBridge(transport);
const tools = await bridge.waitForTools();

console.log(tools);

const result = await bridge.invoke("play_track_for_room", {
  track: "Starboy",
  artist: "The Weeknd",
});

console.log(result);
bridge.close();
transport.close();
```

An LLM host can expose the result of `waitForTools()` as its available tool
definitions, then route the selected tool name and arguments through `invoke()`.
The bridge does not prescribe a particular model or agent framework.

## Protocol

The protocol contains four versioned message types:

```text
PAGE → AGENT
TOOLS { protocol_version, tools_version, tools }

AGENT → PAGE
INVOKE { protocol_version, request_id, tools_version, tool, arguments }

PAGE → AGENT
RESULT { protocol_version, request_id, result }

PAGE → AGENT
ERROR { protocol_version, request_id, error }
```

`tools_version` prevents an agent from invoking a capability manifest that the
page has already replaced. `request_id` correlates each invocation with its
result and lets the page ignore duplicate requests during its current lifetime.

## Transports

### WebSocket relay

`createWebSocketTransport()` is the primary cross-process transport. The page
and agent create separate endpoints with the same session ID and temporary
Phase 1 token:

```ts
const page = createWebSocketTransport({
  url: "wss://relay-webmcpbridge.searchboxlabs.org/v1/ws",
  sessionId,
  token,
  source: "page",
});

const agent = createWebSocketTransport({
  url: "wss://relay-webmcpbridge.searchboxlabs.org/v1/ws",
  sessionId,
  token,
  source: "agent",
});
```

It provides:

- WebSocket `HELLO` and session joining.
- Automatic bounded reconnection.
- Server-assigned message sequences.
- Recipient acknowledgements after subscribers finish processing.
- A bounded local history for messages received before bridge subscription.
- Reconnect cursors through `after_sequence`.
- Five-minute server replay for unacknowledged messages.
- Application heartbeats.
- Publish completion only after relay `ACCEPTED`.

The token must contain 32–256 characters. Generate it using a cryptographically
secure random source and deliver it only to the intended page and agent. It is
a temporary Phase 1 access secret, not the planned production identity and
authorization system.

Call `transport.close()` when the integration is disposed.

### HTTP polling prototype

`createHttpTransport()` expects a session endpoint with this shape:

```text
GET  /api/sessions/:sessionId/protocol
POST /api/sessions/:sessionId/protocol
```

`GET` returns:

```json
{ "messages": [] }
```

`POST` accepts:

```json
{
  "source": "page",
  "message": {
    "type": "TOOLS",
    "protocol_version": 1,
    "tools_version": 1,
    "tools": []
  }
}
```

The included HTTP implementation polls this endpoint and deduplicates envelopes
by ID. It remains available for compatibility and controlled prototypes, but
it is not the recommended transport for active remote sessions. The server must
assign every stored envelope an `id`, `source`, `message`, and `createdAt`.

### In-memory

`createInMemoryTransportPair()` creates connected page and agent transports for
tests and same-process prototypes.

```ts
import { createInMemoryTransportPair } from "@searchboxlabs/webmcp-bridge";

const { page, agent } = createInMemoryTransportPair();
```

### Custom transports

Implement `BridgeTransport` to use WebSockets, IPC, a local Zig service, or
another relay:

```ts
type BridgeTransport = {
  publish(message: BridgeMessage): Promise<void>;
  history(): Promise<BridgeEnvelope[]>;
  subscribe(
    listener: (envelope: BridgeEnvelope) => void | Promise<void>
  ): () => void;
};
```

## Semantic capability boundary

The bridge transports application capabilities, not raw browser or machine
control.

Acceptable:

```text
play_track_for_room({ track: "Starboy" })
```

Outside this protocol's intended boundary:

```text
eval("...")
click({ x: 921, y: 413 })
shell("...")
```

WebMCP answers, “What can this application expose?” A production authorization
layer must separately answer, “May this paired runtime request this operation?”

## Production trust model

The reference flow now implements:

- Durable Ed25519 runtime identity and X25519 key agreement.
- Runtime-signed, expiring, single-use Agent registration tickets.
- Relay-hosted passkey enrollment through a short code tied to a live runtime.
- Runtime-side verification of the original WebAuthn enrollment evidence.
- Owner-passkey assertions over a runtime-signed pairing transcript.
- Binding of the browser key, runtime identity, session, relay origin,
  destination application origin, scopes, nonces, and expiry.
- X25519/HKDF/AES-256-GCM end-to-end encryption after pairing.
- Tool-generation checks, request correlation, relay ACK/replay, and in-process
  ciphertext replay rejection.
- Explicit local approval before a newer owner credential replaces the
  runtime's existing owner.

The relay routes registration and pairing data but cannot forge the runtime's
signatures, derive the encrypted session keys, or execute a WebMCP tool. The
runtime independently verifies fresh enrollment evidence instead of trusting a
relay-generated summary.

Before treating the system as production-grade authority, add durable key
generation and revocation state, a defined lost-passkey recovery policy,
durable replay counters across process/device restarts, persistent-store backup
and compaction, per-client rate limiting at the reverse proxy, and an external
security review. Raw HTTP polling and legacy demo session routes should remain
disabled unless protected by an equivalent authentication layer.

If a native runtime exposes a local endpoint, bind it to `127.0.0.1`, restrict
the accepted web origin, use browser Local Network Access controls where
required, and expose only narrow structured capabilities.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

Run the integration test against the deployed Phase 1 relay:

```sh
WEBMCP_BRIDGE_RELAY_URL=wss://relay-webmcpbridge.searchboxlabs.org/v1/ws npm test
```

## Current status

WebMCP Bridge is a working security-oriented prototype. Its core invariant is:

> The WebMCP capability surface can be projected to an external agent runtime,
> while the browser retains final invocation authority.

The reference implementation has been exercised through a real browser flow:
relay-hosted passkey registration, runtime verification, popup pairing,
encrypted WebSocket session establishment, live WebMCP tool publication, and
browser-context invocation. Durable revocation, recovery, replay state, and
operational hardening remain the main production work.

## License

[MIT](./LICENSE) © 2026 Searchbox Labs
