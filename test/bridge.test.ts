import assert from "node:assert/strict";
import test from "node:test";
import { connectAgentBridge } from "../src/agent.js";
import { startPageBridge, type RegisteredWebMcpTool } from "../src/page.js";
import { createInMemoryTransportPair } from "../src/transport.js";

test("projects page tools to an agent and returns browser execution results", async () => {
  const transports = createInMemoryTransportPair();
  const tool: RegisteredWebMcpTool = {
    name: "plan_daily_soundtrack",
    title: "Plan daily soundtrack",
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

  const stopPage = await startPageBridge({ modelContext, transport: transports.page });
  const agent = await connectAgentBridge(transports.agent);
  assert.deepEqual(agent.listTools().map(({ name }) => name), ["plan_daily_soundtrack"]);
  assert.deepEqual(await agent.invoke("plan_daily_soundtrack", { track: "Manya" }), {
    planned: "Manya",
  });

  agent.close();
  stopPage();
});
