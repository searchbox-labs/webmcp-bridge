import type { BridgeEnvelope, BridgeMessage, BridgePeer } from "./protocol.js";

export type BridgeTransport = {
  publish(message: BridgeMessage): Promise<void>;
  history(): Promise<BridgeEnvelope[]>;
  subscribe(listener: (envelope: BridgeEnvelope) => void): () => void;
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
            listener(envelope);
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

export function createInMemoryTransportPair(): {
  page: BridgeTransport;
  agent: BridgeTransport;
} {
  const envelopes: BridgeEnvelope[] = [];
  const listeners = new Set<(envelope: BridgeEnvelope) => void>();

  function transport(source: BridgePeer): BridgeTransport {
    return {
      async publish(message) {
        const envelope: BridgeEnvelope = {
          id: crypto.randomUUID(),
          source,
          message,
          createdAt: new Date().toISOString(),
        };
        envelopes.push(envelope);
        for (const listener of listeners) queueMicrotask(() => listener(envelope));
      },
      async history() {
        return [...envelopes];
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  return { page: transport("page"), agent: transport("agent") };
}
