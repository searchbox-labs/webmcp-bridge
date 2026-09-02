import assert from "node:assert/strict";
import test from "node:test";
import { connectAgentBridge } from "../src/agent.js";
import { startPageBridge, type RegisteredWebMcpTool } from "../src/page.js";
import { createWebSocketTransport } from "../src/transport.js";

const relayUrl = process.env.WEBMCP_BRIDGE_RELAY_URL;

test("executes a WebMCP tool through the deployed WebSocket relay", {
  skip: relayUrl ? false : "Set WEBMCP_BRIDGE_RELAY_URL to run the relay integration test.",
  timeout: 20_000,
}, async () => {
  const sessionId = `sdk_${crypto.randomUUID().replaceAll("-", "")}`;
  const token = `sdk-token-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const pageTransport = createWebSocketTransport({
    url: relayUrl!,
    sessionId,
    source: "page",
    token,
  });
  const agentTransport = createWebSocketTransport({
    url: relayUrl!,
    sessionId,
    source: "agent",
    token,
  });
  const tool: RegisteredWebMcpTool = {
    name: "plan_daily_soundtrack",
    description: "Plan one track.",
    inputSchema: { type: "object" },
  };
  const modelContext = Object.assign(new EventTarget(), {
    async getTools() {
      return [tool];
    },
    async executeTool(_tool: RegisteredWebMcpTool, input: string) {
      const args = JSON.parse(input) as { track: string };
      return JSON.stringify({ planned: args.track });
    },
  });

  let stopPage: (() => void) | undefined;
  let agent: Awaited<ReturnType<typeof connectAgentBridge>> | undefined;
  try {
    stopPage = await startPageBridge({ modelContext, transport: pageTransport });
    agent = await connectAgentBridge(agentTransport);
    assert.deepEqual((await agent.waitForTools()).map(({ name }) => name), ["plan_daily_soundtrack"]);
    assert.deepEqual(await agent.invoke("plan_daily_soundtrack", { track: "Manya" }), {
      planned: "Manya",
    });
  } finally {
    agent?.close();
    stopPage?.();
    agentTransport.close();
    pageTransport.close();
  }
});
