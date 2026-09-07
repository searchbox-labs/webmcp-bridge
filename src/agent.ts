import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeTool,
  type ErrorMessage,
  type ResultMessage,
  type ToolsMessage,
  type ActionRequestMessage,
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

export type AgentBridgeOptions = {
  onActionRequest?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
};

export async function connectAgentBridge(transport: BridgeTransport, options: AgentBridgeOptions = {}): Promise<AgentBridge> {
  let manifest: ToolsMessage | undefined;
  const pending = new Map<string, PendingInvocation>();
  const toolWaiters = new Set<(tools: BridgeTool[]) => void>();
  const completedActions = new Map<string, { result: unknown; error?: string }>();

  async function handleAction(message: ActionRequestMessage) {
    const completed = completedActions.get(message.request_id);
    if (completed) {
      await transport.publish({ type: "ACTION_RESULT", protocol_version: BRIDGE_PROTOCOL_VERSION, request_id: message.request_id, ...completed });
      return;
    }
    try {
      if (!options.onActionRequest) throw new Error("The runtime does not accept browser-initiated actions.");
      const result = await options.onActionRequest(message.action, message.arguments);
      completedActions.set(message.request_id, { result });
      await transport.publish({ type: "ACTION_RESULT", protocol_version: BRIDGE_PROTOCOL_VERSION, request_id: message.request_id, result });
    } catch (error) {
      const failure = { result: null, error: error instanceof Error ? error.message : String(error) };
      completedActions.set(message.request_id, failure);
      await transport.publish({ type: "ACTION_RESULT", protocol_version: BRIDGE_PROTOCOL_VERSION, request_id: message.request_id, ...failure });
    }
    if (completedActions.size > 512) completedActions.delete(completedActions.keys().next().value!);
  }

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
    if (envelope.source !== "page") return;
    // Do not hold the transport delivery/ACK path open while an action invokes
    // page tools over the same transport. Those RESULT messages must be able
    // to reach this subscriber for the action to complete.
    if (envelope.message.type === "ACTION_REQUEST") {
      void handleAction(envelope.message);
      return;
    }
    if (envelope.message.type === "TOOLS" || envelope.message.type === "RESULT" || envelope.message.type === "ERROR") accept(envelope.message);
  });
  for (const envelope of await transport.history()) {
    if (envelope.source === "page" && envelope.message.type === "ACTION_REQUEST") await handleAction(envelope.message);
    else if (envelope.source === "page" && (envelope.message.type === "TOOLS" || envelope.message.type === "RESULT" || envelope.message.type === "ERROR")) accept(envelope.message);
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
      completedActions.clear();
    },
  };
}
