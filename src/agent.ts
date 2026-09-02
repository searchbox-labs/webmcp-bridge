import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeTool,
  type ErrorMessage,
  type ResultMessage,
  type ToolsMessage,
} from "./protocol.js";
import type { BridgeTransport } from "./transport.js";

type PendingInvocation = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type AgentBridge = {
  listTools(): BridgeTool[];
  waitForTools(timeoutMs?: number): Promise<BridgeTool[]>;
  invoke(tool: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  close(): void;
};

export async function connectAgentBridge(transport: BridgeTransport): Promise<AgentBridge> {
  let manifest: ToolsMessage | undefined;
  const pending = new Map<string, PendingInvocation>();
  const toolWaiters = new Set<(tools: BridgeTool[]) => void>();

  function accept(message: ToolsMessage | ResultMessage | ErrorMessage) {
    if (message.type === "TOOLS") {
      if (!manifest || message.tools_version >= manifest.tools_version) manifest = message;
      for (const waiter of toolWaiters) waiter(message.tools);
      toolWaiters.clear();
      return;
    }
    const invocation = pending.get(message.request_id);
    if (!invocation) return;
    pending.delete(message.request_id);
    clearTimeout(invocation.timer);
    if (message.type === "RESULT") invocation.resolve(message.result);
    else invocation.reject(new Error(message.error));
  }

  // Subscribe before reading history so a page message cannot arrive in the
  // gap between the initial history request and live subscription. A message
  // observed through both paths is harmless: manifests replace by version and
  // completed request IDs are removed from `pending` after the first result.
  const unsubscribe = transport.subscribe((envelope) => {
    if (envelope.source === "page" && envelope.message.type !== "INVOKE") accept(envelope.message);
  });
  for (const envelope of await transport.history()) {
    if (envelope.source === "page" && envelope.message.type !== "INVOKE") accept(envelope.message);
  }

  function waitForTools(timeoutMs = 5_000): Promise<BridgeTool[]> {
    if (manifest) return Promise.resolve(manifest.tools);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        toolWaiters.delete(onTools);
        reject(new Error("Timed out waiting for the page tool manifest."));
      }, timeoutMs);
      const onTools = (tools: BridgeTool[]) => {
        clearTimeout(timer);
        resolve(tools);
      };
      toolWaiters.add(onTools);
    });
  }

  return {
    listTools: () => manifest?.tools ?? [],
    waitForTools,
    async invoke(tool, args, timeoutMs = 10_000) {
      if (!manifest) await waitForTools(timeoutMs);
      const activeManifest = manifest;
      if (!activeManifest?.tools.some(({ name }) => name === tool)) {
        throw new Error(`Tool is not exposed by the page: ${tool}`);
      }
      const requestId = crypto.randomUUID();
      const result = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`Invocation timed out: ${tool}`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
      });
      await transport.publish({
        type: "INVOKE",
        protocol_version: BRIDGE_PROTOCOL_VERSION,
        request_id: requestId,
        tools_version: activeManifest.tools_version,
        tool,
        arguments: args,
      });
      return result;
    },
    close() {
      unsubscribe();
      for (const invocation of pending.values()) {
        clearTimeout(invocation.timer);
        invocation.reject(new Error("Agent bridge closed."));
      }
      pending.clear();
    },
  };
}
