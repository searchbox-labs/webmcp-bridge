import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeTool,
  type InvokeMessage,
  type JsonObject,
} from "./protocol.js";
import type { BridgeTransport } from "./transport.js";
import type { ActionResultMessage } from "./protocol.js";

export type RegisteredWebMcpTool = BridgeTool & { window?: Window; origin?: string };

export type WebMcpModelContext = EventTarget & {
  getTools(): Promise<RegisteredWebMcpTool[]>;
  executeTool(tool: RegisteredWebMcpTool, input: string): Promise<unknown>;
};

export type PageBridgeStatus = {
  connected: boolean;
  toolsVersion: number;
  toolNames: string[];
  lastRequest?: string;
  error?: string;
};

export type PageBridgeOptions = {
  modelContext: WebMcpModelContext;
  transport: BridgeTransport;
  onStatus?: (status: PageBridgeStatus) => void;
};

export async function startPageBridge({
  modelContext,
  transport,
  onStatus,
}: PageBridgeOptions): Promise<() => void> {
  const handled = new Set<string>();
  let disposed = false;
  let toolsVersion = 0;
  let toolNames: string[] = [];

  async function publishTools() {
    const registered = await modelContext.getTools();
    if (disposed) return;
    toolsVersion += 1;
    const tools: BridgeTool[] = registered.map(
      ({ name, title, description, inputSchema, annotations }) => ({
        name,
        title,
        description,
        inputSchema,
        annotations,
      }),
    );
    toolNames = tools.map(({ name }) => name);
    await transport.publish({
      type: "TOOLS",
      protocol_version: BRIDGE_PROTOCOL_VERSION,
      tools_version: toolsVersion,
      tools,
    });
    onStatus?.({ connected: true, toolsVersion, toolNames });
  }

  async function execute(request: InvokeMessage) {
    if (handled.has(request.request_id)) return;
    handled.add(request.request_id);

    try {
      if (request.tools_version !== toolsVersion) {
        throw new Error(`Stale toolset ${request.tools_version}; current version is ${toolsVersion}.`);
      }
      const tool = (await modelContext.getTools()).find(({ name }) => name === request.tool);
      if (!tool) throw new Error(`Tool unavailable: ${request.tool}`);
      const raw = await modelContext.executeTool(tool, JSON.stringify(request.arguments));
      let result = raw;
      if (typeof raw === "string") {
        try {
          result = JSON.parse(raw) as unknown;
        } catch {
          result = raw;
        }
      }
      await transport.publish({
        type: "RESULT",
        protocol_version: BRIDGE_PROTOCOL_VERSION,
        request_id: request.request_id,
        result,
      });
      onStatus?.({ connected: true, toolsVersion, toolNames, lastRequest: request.tool });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await transport.publish({
        type: "ERROR",
        protocol_version: BRIDGE_PROTOCOL_VERSION,
        request_id: request.request_id,
        error: message,
      });
      onStatus?.({ connected: true, toolsVersion, toolNames, error: message });
    }
  }

  const unsubscribe = transport.subscribe(async (envelope) => {
    if (envelope.source !== "agent" || envelope.message.type !== "INVOKE") return;
    await execute(envelope.message);
  });
  const onToolChange = () => void publishTools();
  modelContext.addEventListener("toolchange", onToolChange);
  await publishTools();

  return () => {
    disposed = true;
    unsubscribe();
    modelContext.removeEventListener("toolchange", onToolChange);
  };
}

export type ToolArguments = JsonObject;

export type PageActionBridge = {
  request(action: string, args: JsonObject, timeoutMs?: number): Promise<unknown>;
  notify(action: string, args: JsonObject): Promise<void>;
  close(): void;
};

export async function connectPageActionBridge(transport: BridgeTransport): Promise<PageActionBridge> {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const accept = (message: ActionResultMessage) => {
    const request = pending.get(message.request_id);
    if (!request) return;
    pending.delete(message.request_id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  };
  const unsubscribe = transport.subscribe((envelope) => {
    if (envelope.source === "agent" && envelope.message.type === "ACTION_RESULT") accept(envelope.message);
  });
  for (const envelope of await transport.history()) {
    if (envelope.source === "agent" && envelope.message.type === "ACTION_RESULT") accept(envelope.message);
  }
  return {
    async notify(action, args) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(action)) throw new TypeError("Invalid action name.");
      await transport.publish({ type: "ACTION_REQUEST", protocol_version: BRIDGE_PROTOCOL_VERSION, request_id: crypto.randomUUID(), action, arguments: args });
    },
    async request(action, args, timeoutMs = 30_000) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(action)) throw new TypeError("Invalid action name.");
      const requestId = crypto.randomUUID();
      const result = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Action timed out: ${action}`)); }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
      });
      await transport.publish({ type: "ACTION_REQUEST", protocol_version: BRIDGE_PROTOCOL_VERSION, request_id: requestId, action, arguments: args });
      return result;
    },
    close() {
      unsubscribe();
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Page action bridge closed.")); }
      pending.clear();
    },
  };
}
