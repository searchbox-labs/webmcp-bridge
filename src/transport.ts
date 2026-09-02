import {
  isBridgeMessage,
  type BridgeEnvelope,
  type BridgeMessage,
  type BridgePeer,
} from "./protocol.js";

export type BridgeTransport = {
  publish(message: BridgeMessage): Promise<void>;
  history(): Promise<BridgeEnvelope[]>;
  subscribe(listener: (envelope: BridgeEnvelope) => void | Promise<void>): () => void;
};

export type ClosableBridgeTransport = BridgeTransport & {
  close(): void;
};

export type HttpTransportOptions = {
  baseUrl: string;
  sessionId: string;
  source: BridgePeer;
  pollIntervalMs?: number;
};

export function createHttpTransport({
  baseUrl,
  sessionId,
  source,
  pollIntervalMs = 250,
}: HttpTransportOptions): BridgeTransport {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/sessions/${encodeURIComponent(sessionId)}/protocol`;

  async function history() {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`Bridge read failed with ${response.status}.`);
    const body = (await response.json()) as { messages?: BridgeEnvelope[] };
    return body.messages ?? [];
  }

  return {
    async publish(message) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, message }),
      });
      if (!response.ok) throw new Error(`Bridge write failed with ${response.status}.`);
    },
    history,
    subscribe(listener) {
      let stopped = false;
      const seen = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | undefined;

      async function poll() {
        if (stopped) return;
        try {
          for (const envelope of await history()) {
            if (seen.has(envelope.id)) continue;
            seen.add(envelope.id);
            await listener(envelope);
          }
        } finally {
          if (!stopped) timer = setTimeout(poll, pollIntervalMs);
        }
      }

      void poll();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },
  };
}

type RelayReady = {
  type: "READY";
  session_id: string;
  peer: BridgePeer;
  current_sequence: number;
  replay_window_ms: number;
};

type RelayMessage = {
  type: "MESSAGE";
  sequence: number;
  source: BridgePeer;
  created_at_ms: number;
  expires_at_ms: number;
  message: BridgeMessage;
};

type RelayAccepted = { type: "ACCEPTED"; sequence: number };
type RelayDelivered = { type: "DELIVERED"; sequence: number };
type RelayError = { type: "RELAY_ERROR"; code: string; message: string };
type RelayPong = { type: "PONG" };
type RelayServerMessage = RelayReady | RelayMessage | RelayAccepted | RelayDelivered | RelayError | RelayPong;

type ReadyWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingPublish = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export type WebSocketTransportOptions = {
  url: string;
  sessionId: string;
  source: BridgePeer;
  token: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  connectionTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  historyLimit?: number;
  webSocketFactory?: (url: string) => WebSocket;
};

/**
 * Connects one page or agent endpoint to a WebMCP Bridge Relay WebSocket.
 *
 * The transport acknowledges a relay message only after every active
 * subscriber has completed. Received envelopes are retained in a bounded
 * local history so a bridge that subscribes just after connection can still
 * discover replayed messages. On reconnect, `after_sequence` tells the relay
 * which messages this endpoint has already processed.
 *
 * Phase 1 uses a shared session token. It is an access secret, not the planned
 * certificate-based production authentication mechanism.
 */
export function createWebSocketTransport({
  url,
  sessionId,
  source,
  token,
  reconnectDelayMs = 250,
  maxReconnectDelayMs = 5_000,
  connectionTimeoutMs = 10_000,
  heartbeatIntervalMs = 25_000,
  historyLimit = 512,
  webSocketFactory = (target) => new WebSocket(target),
}: WebSocketTransportOptions): ClosableBridgeTransport {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new Error("sessionId must contain only letters, numbers, underscores, and hyphens.");
  }
  if (token.length < 32 || token.length > 256) {
    throw new Error("The Phase 1 session token must contain between 32 and 256 characters.");
  }

  const listeners = new Set<(envelope: BridgeEnvelope) => void | Promise<void>>();
  const envelopes: BridgeEnvelope[] = [];
  const readyWaiters = new Set<ReadyWaiter>();
  const pendingPublishes: PendingPublish[] = [];
  let socket: WebSocket | undefined;
  let stopped = false;
  let ready = false;
  let lastProcessedSequence = 0;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let incoming = Promise.resolve();

  function waitUntilReady(): Promise<void> {
    if (ready) return Promise.resolve();
    if (stopped) return Promise.reject(new Error("WebSocket transport is closed."));
    return new Promise((resolve, reject) => {
      const waiter: ReadyWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          readyWaiters.delete(waiter);
          reject(new Error(`Timed out connecting to the WebMCP relay at ${url}.`));
        }, connectionTimeoutMs),
      };
      readyWaiters.add(waiter);
    });
  }

  function resolveReadyWaiters() {
    for (const waiter of readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    readyWaiters.clear();
  }

  function rejectPendingPublishes(error: Error) {
    for (const pending of pendingPublishes.splice(0)) pending.reject(error);
  }

  function send(value: unknown) {
    if (!socket || socket.readyState !== 1) {
      throw new Error("WebSocket relay is not connected.");
    }
    socket.send(JSON.stringify(value));
  }

  async function eventText(data: unknown): Promise<string> {
    if (typeof data === "string") return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
    throw new Error("Relay sent an unsupported WebSocket payload.");
  }

  async function decodeServerMessage(data: unknown): Promise<RelayServerMessage> {
    return JSON.parse(await eventText(data)) as RelayServerMessage;
  }

  async function processServerMessage(parsed: RelayServerMessage) {
    if (parsed.type === "READY") {
      if (parsed.session_id !== sessionId || parsed.peer !== source) {
        throw new Error("Relay READY identity does not match this transport.");
      }
      ready = true;
      reconnectAttempt = 0;
      resolveReadyWaiters();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ready) {
          try {
            send({ type: "PING" });
          } catch {
            // The close event owns reconnection.
          }
        }
      }, heartbeatIntervalMs);
      return;
    }
    if (parsed.type === "MESSAGE") {
      if (!Number.isSafeInteger(parsed.sequence) || parsed.sequence <= 0) {
        throw new Error("Relay MESSAGE has an invalid sequence.");
      }
      if (parsed.source === source) throw new Error("Relay reflected a peer's own message.");
      if (!isBridgeMessage(parsed.message)) throw new Error("Relay MESSAGE contains an invalid bridge message.");
      const envelope: BridgeEnvelope = {
        id: `${sessionId}:${parsed.sequence}`,
        source: parsed.source,
        message: parsed.message,
        createdAt: new Date(parsed.created_at_ms).toISOString(),
      };
      envelopes.push(envelope);
      if (envelopes.length > historyLimit) envelopes.splice(0, envelopes.length - historyLimit);
      for (const listener of listeners) await listener(envelope);
      send({ type: "ACK", sequence: parsed.sequence });
      lastProcessedSequence = Math.max(lastProcessedSequence, parsed.sequence);
      return;
    }
    if (parsed.type === "ACCEPTED") {
      pendingPublishes.shift()?.resolve();
      return;
    }
    if (parsed.type === "RELAY_ERROR") {
      const error = new Error(`Relay rejected the request (${parsed.code}): ${parsed.message}`);
      const pending = pendingPublishes.shift();
      if (pending) pending.reject(error);
      else if (!ready) {
        for (const waiter of readyWaiters) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        readyWaiters.clear();
      }
      return;
    }
    // DELIVERED confirms recipient processing to the relay. PONG confirms
    // liveness. Neither maps to a BridgeEnvelope consumed by page.ts/agent.ts.
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(reconnectDelayMs * 2 ** reconnectAttempt, maxReconnectDelayMs);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function connect() {
    if (stopped) return;
    const connection = webSocketFactory(url);
    socket = connection;

    connection.addEventListener("open", () => {
      if (socket !== connection || stopped) return;
      connection.send(JSON.stringify({
        type: "HELLO",
        session_id: sessionId,
        token,
        peer: source,
        after_sequence: lastProcessedSequence,
      }));
    });
    connection.addEventListener("message", (event) => {
      void decodeServerMessage(event.data)
        .then((message) => {
          if (message.type === "MESSAGE") {
            incoming = incoming
              .then(() => processServerMessage(message))
              .catch(() => connection.close());
          } else {
            void processServerMessage(message).catch(() => connection.close());
          }
        })
        .catch(() => connection.close());
    });
    connection.addEventListener("close", () => {
      if (socket !== connection) return;
      socket = undefined;
      ready = false;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      rejectPendingPublishes(new Error("WebSocket relay disconnected before accepting the message."));
      scheduleReconnect();
    });
    connection.addEventListener("error", () => {
      // Browsers expose little error detail; close drives bounded reconnection.
    });
  }

  connect();

  return {
    async publish(message) {
      await waitUntilReady();
      return new Promise<void>((resolve, reject) => {
        const pending = { resolve, reject };
        pendingPublishes.push(pending);
        try {
          send({ type: "PUBLISH", message });
        } catch (error) {
          const index = pendingPublishes.indexOf(pending);
          if (index >= 0) pendingPublishes.splice(index, 1);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    async history() {
      return [...envelopes];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (stopped) return;
      stopped = true;
      ready = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      for (const waiter of readyWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("WebSocket transport closed."));
      }
      readyWaiters.clear();
      rejectPendingPublishes(new Error("WebSocket transport closed."));
      socket?.close(1000, "transport closed");
      socket = undefined;
      listeners.clear();
    },
  };
}

/**
 * Creates connected page and agent transports inside one JavaScript process.
 *
 * This transport pair exists primarily for tests and same-process prototypes.
 * It preserves the same `BridgeTransport` boundary used by real transports,
 * while removing HTTP, session servers, databases, and network behavior from
 * the test. That separation makes failures easier to locate:
 *
 * - If an in-memory bridge test fails, inspect the page bridge, agent bridge,
 *   or protocol behavior.
 * - If it passes but an HTTP integration fails, inspect the HTTP transport or
 *   session server.
 *
 * The application or test assembling the bridge calls this function, then
 * gives `page` to `startPageBridge()` and `agent` to `connectAgentBridge()`:
 *
 * ```ts
 * const transports = createInMemoryTransportPair();
 * const stopPage = await startPageBridge({
 *   modelContext,
 *   transport: transports.page,
 * });
 * const agent = await connectAgentBridge(transports.agent);
 * ```
 *
 * Both endpoints share one append-only envelope array and one listener set.
 * Publishing through an endpoint fixes the envelope source to either `page`
 * or `agent`, stores the envelope in history, and asynchronously notifies
 * subscribers. History allows a peer that connects later in the same process
 * to observe messages that were published before it subscribed.
 *
 * Nothing is authenticated, isolated, persisted, or transmitted over a
 * network. All history disappears when the process ends. Do not use this as a
 * production transport or across browser, native-runtime, or machine
 * boundaries; use HTTP, WebSocket, IPC, or another `BridgeTransport`
 * implementation for those cases.
 */
export function createInMemoryTransportPair(): {
  page: BridgeTransport;
  agent: BridgeTransport;
} {
  // Shared state connects the two logical endpoints without collapsing their
  // separate page/agent transport interfaces.
  const envelopes: BridgeEnvelope[] = [];
  const listeners = new Set<(envelope: BridgeEnvelope) => void | Promise<void>>();

  function transport(source: BridgePeer): BridgeTransport {
    return {
      async publish(message) {
        // The endpoint, rather than its caller, assigns the peer identity. This
        // keeps test calls consistent with real page and agent transports.
        const envelope: BridgeEnvelope = {
          id: crypto.randomUUID(),
          source,
          message,
          createdAt: new Date().toISOString(),
        };
        envelopes.push(envelope);
        // Deliver on a microtask so tests exercise asynchronous message flow
        // instead of relying on synchronous callback execution.
        for (const listener of listeners) queueMicrotask(() => void listener(envelope));
      },
      async history() {
        // Return a copy so consumers cannot mutate the shared session history.
        return [...envelopes];
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  // Each endpoint closes over a fixed source while sharing history/listeners.
  return { page: transport("page"), agent: transport("agent") };
}
