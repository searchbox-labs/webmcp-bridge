import assert from "node:assert/strict";
import test from "node:test";
import { connectAgentBridge } from "../src/agent.js";
import { connectPageActionBridge, startPageBridge, type RegisteredWebMcpTool } from "../src/page.js";
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

test("carries a narrow browser action to the paired runtime and returns its result", async () => {
  const transports = createInMemoryTransportPair();
  const page = await connectPageActionBridge(transports.page);
  const agent = await connectAgentBridge(transports.agent, {
    async onActionRequest(action, args) {
      assert.equal(action, "play_emotional_playlist");
      assert.deepEqual(args, { playlist: [{ id: "one", title: "Three Little Birds", artist: "Bob Marley & The Wailers" }] });
      return { playing: "spotify:track:123" };
    },
  });
  assert.deepEqual(await page.request("play_emotional_playlist", { playlist: [{ id: "one", title: "Three Little Birds", artist: "Bob Marley & The Wailers" }] }), { playing: "spotify:track:123" });
  page.close();
  agent.close();
});

test("notifies the runtime without waiting for an action result", async () => {
  const transports = createInMemoryTransportPair();
  const page = await connectPageActionBridge(transports.page);
  let received = false;
  const agent = await connectAgentBridge(transports.agent, {
    async onActionRequest(action) {
      assert.equal(action, "play_emotional_playlist");
      received = true;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { accepted: true };
    },
  });
  await page.notify("play_emotional_playlist", { playlist: [] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(received, true);
  page.close();
  agent.close();
});
