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

> **Security status:** the transports included in this initial release are
> unauthenticated prototypes. They are suitable for local development and
> controlled demos, not production authority. See [Production trust model](#production-trust-model).

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
- `@searchboxlabs/webmcp-bridge/protocol`
- `@searchboxlabs/webmcp-bridge/transport`

## Page-side usage

Register the application's WebMCP tools normally, create a page transport, and
start the bridge with the page's `document.modelContext`.

```ts
import {
  createHttpTransport,
  startPageBridge,
  type WebMcpModelContext,
} from "@searchboxlabs/webmcp-bridge";

const sessionId = new URL(location.href).searchParams.get("session")!;

const transport = createHttpTransport({
  baseUrl: location.origin,
  sessionId,
  source: "page",
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
  createHttpTransport,
} from "@searchboxlabs/webmcp-bridge";

const transport = createHttpTransport({
  baseUrl: "https://app.example",
  sessionId: "abc123",
  source: "agent",
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

### HTTP polling

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

The included implementation polls this endpoint and deduplicates envelopes by
ID. The relay must assign every stored envelope an `id`, `source`, `message`,
and `createdAt` value.

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
  subscribe(listener: (envelope: BridgeEnvelope) => void): () => void;
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

The current SDK implements capability projection, toolset version checks,
request correlation, timeouts, and browser-context execution. It does **not**
yet implement the production controls below.

A production deployment should add:

- OAuth 2.0 Authorization Code with PKCE and validated `state` and OIDC `nonce`.
- A non-exportable browser signing key.
- A single-use runtime pairing challenge.
- A backend-signed, short-lived certificate binding the authenticated user,
  browser public key, runtime ID, pairing challenge, scopes, key generation,
  issue time, and expiry.
- Signatures on meaningful session messages.
- Session ID, sender, sequence number, timestamp, and key generation in each
  signed message.
- Replay, stale-sequence, expiry, revoked-key, and stale-toolset rejection.
- Narrow, incrementally granted scopes such as `spotify.read` and
  `spotify.control`.
- Fresh authentication for browser-key rotation; an old key must never be able
  to authorize its replacement.
- Revocation of every older key generation after rotation.

The relay may carry certificates and signed messages, but it must not be the
source of authority. Receivers must verify authorization-backend certificates
and peer signatures themselves.

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

## Current status

WebMCP Bridge is an early prototype. Its core invariant is:

> The WebMCP capability surface can be projected to an external agent runtime,
> while the browser retains final invocation authority.

Authentication, signed sessions, scoped authorization, durable replay
protection, key rotation, and revocation are architectural requirements for a
production release and remain to be implemented.

## License

[MIT](./LICENSE) © 2026 Searchbox Labs
