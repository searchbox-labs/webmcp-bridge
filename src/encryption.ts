import {
  BRIDGE_PROTOCOL_VERSION,
  isBridgeMessage,
  type BridgeEnvelope,
  type BridgeMessage,
  type BridgePeer,
} from "./protocol.js";
import type { BridgeTransport, ClosableBridgeTransport } from "./transport.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type EncryptedBridgeMessage = {
  type: BridgeMessage["type"];
  protocol_version: typeof BRIDGE_PROTOCOL_VERSION;
  encrypted: true;
  encryption_version: 1;
  algorithm: "X25519-HKDF-SHA256-AES-256-GCM";
  key_id: string;
  sender_instance_id: string;
  sequence: number;
  iv: string;
  ciphertext: string;
};

export type SessionKeyPair = {
  privateKey: CryptoKey;
  publicKey: string;
};

type EncryptedTransportBaseOptions = {
  transport: BridgeTransport;
  sessionId: string;
  source: BridgePeer;
};

export type EncryptedTransportOptions = EncryptedTransportBaseOptions & {
  privateKey: CryptoKey;
  peerPublicKey: string;
  sharedSecret?: never;
} | EncryptedTransportBaseOptions & {
  sharedSecret: string;
  privateKey?: never;
  peerPublicKey?: never;
};

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digest(value: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

export async function deriveRelaySessionToken(sharedSecret: string, sessionId: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", decodeBase64Url(sharedSecret), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256",
    salt: await digest(textEncoder.encode(`webmcp-bridge:relay:${sessionId}`)),
    info: textEncoder.encode("webmcp-bridge:relay-token:v1") }, material, 256);
  return encodeBase64Url(bits);
}

export async function deriveX25519SharedSecret(privateKey: CryptoKey, peerPublicKey: string): Promise<string> {
  const publicKey = await crypto.subtle.importKey("raw", decodeBase64Url(peerPublicKey), "X25519", false, []);
  return encodeBase64Url(await crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256));
}

export async function generateSessionKeyPair(): Promise<SessionKeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: "X25519" },
    false,
    ["deriveBits"],
  )) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicKey: encodeBase64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}

async function deriveDirectionalKey(
  keyAgreement: { privateKey: CryptoKey; peerPublicKey: string } | { sharedSecret: string },
  sessionId: string,
  direction: string,
): Promise<CryptoKey> {
  const sharedSecret = "sharedSecret" in keyAgreement ? decodeBase64Url(keyAgreement.sharedSecret) : await (async () => {
    const publicKey = await crypto.subtle.importKey("raw", decodeBase64Url(keyAgreement.peerPublicKey), { name: "X25519" }, false, []);
    return crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, keyAgreement.privateKey, 256);
  })();
  const material = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: await digest(textEncoder.encode(`webmcp-bridge:${sessionId}`)),
      info: textEncoder.encode(`webmcp-bridge:v1:${direction}`),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function additionalData(
  message: Omit<EncryptedBridgeMessage, "iv" | "ciphertext">,
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode([
    message.protocol_version,
    message.encryption_version,
    message.type,
    message.key_id,
    message.sender_instance_id,
    message.sequence,
  ].join("\n"));
}

function isEncryptedMessage(value: unknown): value is EncryptedBridgeMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<EncryptedBridgeMessage>;
  return candidate.encrypted === true &&
    candidate.encryption_version === 1 &&
    candidate.algorithm === "X25519-HKDF-SHA256-AES-256-GCM" &&
    candidate.protocol_version === BRIDGE_PROTOCOL_VERSION &&
    typeof candidate.key_id === "string" &&
    typeof candidate.sender_instance_id === "string" &&
    Number.isSafeInteger(candidate.sequence) &&
    (candidate.sequence ?? 0) > 0 &&
    typeof candidate.iv === "string" &&
    typeof candidate.ciphertext === "string";
}

/**
 * Encrypts every bridge message before it reaches the relay and decrypts only
 * messages from the paired peer. The relay retains the outer message type for
 * direction enforcement, but tools, arguments, results, and errors are AES-GCM
 * ciphertext. X25519 and HKDF derive independent page→agent and agent→page
 * keys. AES-GCM authenticates both ciphertext and routing metadata.
 */
export async function createEncryptedTransport({
  transport,
  sessionId,
  source,
  ...keyAgreement
}: EncryptedTransportOptions): Promise<ClosableBridgeTransport> {
  const destination: BridgePeer = source === "page" ? "agent" : "page";
  const [sendKey, receiveKey] = await Promise.all([
    deriveDirectionalKey(keyAgreement, sessionId, `${source}-to-${destination}`),
    deriveDirectionalKey(keyAgreement, sessionId, `${destination}-to-${source}`),
  ]);
  const keyId = encodeBase64Url(
    (await digest(textEncoder.encode(`webmcp-bridge:key:${sessionId}`))).slice(0, 12),
  );
  const senderInstanceId = crypto.randomUUID();
  const receivedSequences = new Map<string, number>();
  // One encrypted transport can serve multiple logical bridges (for example,
  // the page tool bridge and the browser-action bridge). The underlying
  // transport delivers the same envelope to every subscriber, so decrypt it
  // once and share the result. Without this cache, the second subscriber sees
  // the first subscriber's valid message as a replay and can prevent the
  // WebSocket transport from acknowledging it.
  const decryptedEnvelopes = new Map<string, Promise<BridgeEnvelope>>();
  const decryptedEnvelopeLimit = 1_024;
  let sendSequence = 0;

  async function decryptEnvelope(envelope: BridgeEnvelope): Promise<BridgeEnvelope> {
    const wire = envelope.message as unknown;
    if (!isEncryptedMessage(wire)) throw new Error("Received an unencrypted bridge message.");
    if (wire.key_id !== keyId) throw new Error("Encrypted bridge message uses an unexpected key.");
    const previous = receivedSequences.get(wire.sender_instance_id) ?? 0;
    if (wire.sequence <= previous) throw new Error("Rejected a replayed encrypted bridge message.");
    const metadata = {
      type: wire.type,
      protocol_version: wire.protocol_version,
      encrypted: wire.encrypted,
      encryption_version: wire.encryption_version,
      algorithm: wire.algorithm,
      key_id: wire.key_id,
      sender_instance_id: wire.sender_instance_id,
      sequence: wire.sequence,
    } satisfies Omit<EncryptedBridgeMessage, "iv" | "ciphertext">;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(wire.iv), additionalData: additionalData(metadata) },
      receiveKey,
      decodeBase64Url(wire.ciphertext),
    );
    const message = JSON.parse(textDecoder.decode(plaintext)) as unknown;
    if (!isBridgeMessage(message) || message.type !== wire.type) {
      throw new Error("Decrypted bridge message is invalid.");
    }
    receivedSequences.set(wire.sender_instance_id, wire.sequence);
    return { ...envelope, message };
  }

  function decryptEnvelopeOnce(envelope: BridgeEnvelope): Promise<BridgeEnvelope> {
    const existing = decryptedEnvelopes.get(envelope.id);
    if (existing) return existing;

    const pending = decryptEnvelope(envelope);
    decryptedEnvelopes.set(envelope.id, pending);
    if (decryptedEnvelopes.size > decryptedEnvelopeLimit) {
      decryptedEnvelopes.delete(decryptedEnvelopes.keys().next().value!);
    }
    void pending.catch(() => {
      if (decryptedEnvelopes.get(envelope.id) === pending) decryptedEnvelopes.delete(envelope.id);
    });
    return pending;
  }

  return {
    async publish(message) {
      sendSequence += 1;
      const metadata = {
        type: message.type,
        protocol_version: BRIDGE_PROTOCOL_VERSION,
        encrypted: true,
        encryption_version: 1,
        algorithm: "X25519-HKDF-SHA256-AES-256-GCM",
        key_id: keyId,
        sender_instance_id: senderInstanceId,
        sequence: sendSequence,
      } satisfies Omit<EncryptedBridgeMessage, "iv" | "ciphertext">;
      const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: additionalData(metadata) },
        sendKey,
        textEncoder.encode(JSON.stringify(message)),
      );
      const wire: EncryptedBridgeMessage = {
        ...metadata,
        iv: encodeBase64Url(iv),
        ciphertext: encodeBase64Url(ciphertext),
      };
      await transport.publish(wire as unknown as BridgeMessage);
    },
    async history() {
      return Promise.all(
        (await transport.history())
          .filter((envelope) => envelope.source !== source)
          .map(decryptEnvelopeOnce),
      );
    },
    subscribe(listener) {
      return transport.subscribe(async (envelope) => {
        if (envelope.source === source) return;
        await listener(await decryptEnvelopeOnce(envelope));
      });
    },
    close() {
      if ("close" in transport && typeof transport.close === "function") transport.close();
    },
  };
}
