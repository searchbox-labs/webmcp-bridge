import assert from "node:assert/strict";
import test from "node:test";
import { connectAgentBridge } from "../src/agent.js";
import { createEncryptedTransport, deriveRelaySessionToken, generateSessionKeyPair } from "../src/encryption.js";
import { connectPageActionBridge, startPageBridge, type RegisteredWebMcpTool } from "../src/page.js";
import { createInMemoryTransportPair } from "../src/transport.js";

test("encrypts tools, invocations, and results end to end", async () => {
  const raw = createInMemoryTransportPair();
  const [pageKeys, agentKeys] = await Promise.all([
    generateSessionKeyPair(),
    generateSessionKeyPair(),
  ]);
  const [pageTransport, agentTransport] = await Promise.all([
    createEncryptedTransport({
      transport: raw.page,
      sessionId: "encrypted-test",
      source: "page",
      privateKey: pageKeys.privateKey,
      peerPublicKey: agentKeys.publicKey,
    }),
    createEncryptedTransport({
      transport: raw.agent,
      sessionId: "encrypted-test",
      source: "agent",
      privateKey: agentKeys.privateKey,
      peerPublicKey: pageKeys.publicKey,
    }),
  ]);
  const tool: RegisteredWebMcpTool = {
    name: "plan_daily_soundtrack",
    description: "Plan one track.",
    inputSchema: { type: "object" },
  };
  const modelContext = Object.assign(new EventTarget(), {
    async getTools() { return [tool]; },
    async executeTool(_tool: RegisteredWebMcpTool, input: string) {
      return { planned: (JSON.parse(input) as { track: string }).track };
    },
  });

  const stopPage = await startPageBridge({ modelContext, transport: pageTransport });
  const wireHistory = await raw.agent.history();
  assert.equal(wireHistory.length, 1);
  assert.equal(JSON.stringify(wireHistory).includes("plan_daily_soundtrack"), false);

  const agent = await connectAgentBridge(agentTransport);
  assert.deepEqual(await agent.invoke("plan_daily_soundtrack", { track: "Manya" }), {
    planned: "Manya",
  });
  assert.equal(JSON.stringify(await raw.page.history()).includes("Manya"), false);

  agent.close();
  stopPage();
  agentTransport.close();
  pageTransport.close();
});

test("accepts a precomputed X25519 shared secret at the native runtime boundary", async () => {
  const raw = createInMemoryTransportPair();
  const [pageKeys, agentKeys] = await Promise.all([generateSessionKeyPair(), generateSessionKeyPair()]);
  const agentPublic = await crypto.subtle.importKey("raw", Buffer.from(agentKeys.publicKey, "base64url"), "X25519", false, []);
  const shared = Buffer.from(await crypto.subtle.deriveBits({ name: "X25519", public: agentPublic }, pageKeys.privateKey, 256)).toString("base64url");
  const [page, agent] = await Promise.all([
    createEncryptedTransport({ transport: raw.page, sessionId: "native-boundary", source: "page", privateKey: pageKeys.privateKey, peerPublicKey: agentKeys.publicKey }),
    createEncryptedTransport({ transport: raw.agent, sessionId: "native-boundary", source: "agent", sharedSecret: shared }),
  ]);
  await page.publish({ type: "TOOLS", protocol_version: 1, tools_version: 1, tools: [] });
  assert.equal((await agent.history())[0]?.message.type, "TOOLS");
  assert.equal(await deriveRelaySessionToken(shared, "native-boundary"), await deriveRelaySessionToken(shared, "native-boundary"));
  page.close(); agent.close();
});

test("rejects replayed encrypted messages", async () => {
  const raw = createInMemoryTransportPair();
  const [pageKeys, agentKeys] = await Promise.all([generateSessionKeyPair(), generateSessionKeyPair()]);
  const pageTransport = await createEncryptedTransport({
    transport: raw.page,
    sessionId: "replay-test",
    source: "page",
    privateKey: pageKeys.privateKey,
    peerPublicKey: agentKeys.publicKey,
  });
  await pageTransport.publish({ type: "TOOLS", protocol_version: 1, tools_version: 1, tools: [] });
  const original = (await raw.agent.history())[0]!;
  let replay = false;
  const replayTransport = {
    async publish() { throw new Error("unused"); },
    async history() {
      return [replay ? { ...original, id: `${original.id}-replay` } : original];
    },
    subscribe() { return () => undefined; },
  };
  const agentTransport = await createEncryptedTransport({
    transport: replayTransport,
    sessionId: "replay-test",
    source: "agent",
    privateKey: agentKeys.privateKey,
    peerPublicKey: pageKeys.publicKey,
  });
  const first = await agentTransport.history();
  assert.equal(first[0]?.message.type, "TOOLS");
  replay = true;
  await assert.rejects(agentTransport.history(), /replayed encrypted bridge message/i);
  pageTransport.close();
  agentTransport.close();
});

test("shares each decrypted envelope across multiple page bridges", async () => {
  const raw = createInMemoryTransportPair();
  const [pageKeys, agentKeys] = await Promise.all([generateSessionKeyPair(), generateSessionKeyPair()]);
  const [pageTransport, agentTransport] = await Promise.all([
    createEncryptedTransport({
      transport: raw.page,
      sessionId: "multiple-page-bridges",
      source: "page",
      privateKey: pageKeys.privateKey,
      peerPublicKey: agentKeys.publicKey,
    }),
    createEncryptedTransport({
      transport: raw.agent,
      sessionId: "multiple-page-bridges",
      source: "agent",
      privateKey: agentKeys.privateKey,
      peerPublicKey: pageKeys.publicKey,
    }),
  ]);
  const actionBridge = await connectPageActionBridge(pageTransport);
  const modelContext = Object.assign(new EventTarget(), {
    async getTools() { return []; },
    async executeTool() { throw new Error("unused"); },
  });
  const stopPageBridge = await startPageBridge({ modelContext, transport: pageTransport });
  const received: string[] = [];
  const agent = await connectAgentBridge(agentTransport, {
    async onActionRequest(action) {
      received.push(action);
      return { action, accepted: true };
    },
  });

  assert.deepEqual(await actionBridge.request("first_action", {}), {
    action: "first_action",
    accepted: true,
  });
  assert.deepEqual(await actionBridge.request("get_0g_backup_wallet", {}), {
    action: "get_0g_backup_wallet",
    accepted: true,
  });
  assert.deepEqual(received, ["first_action", "get_0g_backup_wallet"]);

  agent.close();
  stopPageBridge();
  actionBridge.close();
  agentTransport.close();
  pageTransport.close();
});

test("rejects encrypted messages with tampered authenticated metadata", async () => {
  const raw = createInMemoryTransportPair();
  const [pageKeys, agentKeys] = await Promise.all([generateSessionKeyPair(), generateSessionKeyPair()]);
  const agentTransport = await createEncryptedTransport({
    transport: raw.agent,
    sessionId: "tamper-test",
    source: "agent",
    privateKey: agentKeys.privateKey,
    peerPublicKey: pageKeys.publicKey,
  });
  const pageTransport = await createEncryptedTransport({
    transport: raw.page,
    sessionId: "tamper-test",
    source: "page",
    privateKey: pageKeys.privateKey,
    peerPublicKey: agentKeys.publicKey,
  });
  await pageTransport.publish({ type: "TOOLS", protocol_version: 1, tools_version: 1, tools: [] });
  const envelope = (await raw.agent.history())[0]!;
  const wire = structuredClone(envelope);
  const message = wire.message as Record<string, unknown>;
  message.sequence = 999;
  const replayTransport = {
    async publish() { throw new Error("unused"); },
    async history() { return [wire]; },
    subscribe() { return () => undefined; },
  };
  const decryptor = await createEncryptedTransport({
    transport: replayTransport,
    sessionId: "tamper-test",
    source: "agent",
    privateKey: agentKeys.privateKey,
    peerPublicKey: pageKeys.publicKey,
  });
  await assert.rejects(decryptor.history(), /operation-specific reason|decrypt|encrypted bridge message/i);
  decryptor.close();
  pageTransport.close();
  agentTransport.close();
});
