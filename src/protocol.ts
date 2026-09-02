export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type JsonObject = Record<string, unknown>;

export type BridgeTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object | string;
  annotations?: JsonObject;
};

export type ToolsMessage = {
  type: "TOOLS";
  protocol_version: typeof BRIDGE_PROTOCOL_VERSION;
  tools_version: number;
  tools: BridgeTool[];
};

export type InvokeMessage = {
  type: "INVOKE";
  protocol_version: typeof BRIDGE_PROTOCOL_VERSION;
  request_id: string;
  tools_version: number;
  tool: string;
  arguments: JsonObject;
};

export type ResultMessage = {
  type: "RESULT";
  protocol_version: typeof BRIDGE_PROTOCOL_VERSION;
  request_id: string;
  result: unknown;
};

export type ErrorMessage = {
  type: "ERROR";
  protocol_version: typeof BRIDGE_PROTOCOL_VERSION;
  request_id: string;
  error: string;
};

export type BridgeMessage = ToolsMessage | InvokeMessage | ResultMessage | ErrorMessage;
export type BridgePeer = "page" | "agent";

export type BridgeEnvelope = {
  id: string;
  source: BridgePeer;
  message: BridgeMessage;
  createdAt: string;
};

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<BridgeMessage>;
  return (
    candidate.protocol_version === BRIDGE_PROTOCOL_VERSION &&
    (candidate.type === "TOOLS" ||
      candidate.type === "INVOKE" ||
      candidate.type === "RESULT" ||
      candidate.type === "ERROR")
  );
}
