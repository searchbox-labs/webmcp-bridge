/// <reference types="webmcp-types" />

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  createWebSocketTransport,
  createEncryptedTransport,
  connectPageActionBridge,
  startPageBridge,
  type ClosableBridgeTransport,
  type PageActionBridge,
  type PageBridgeStatus,
  type WebMcpModelContext,
} from "@searchboxlabs/webmcp-bridge";
import { EmotionalStatePicker } from "./emotional-state-picker";
import type { EmotionalCheckIn } from "./emotional-state";
import { ReachableStatePlan } from "./reachable-state-plan";
import { planReachableState } from "./reachable-state-planner";
import type { ReachableStatePlan as ReachableStatePlanValue } from "./reachable-state-planner";
import { createPodsOnMarsTools, type PlaylistItem } from "./webmcp-capabilities";
import { adaptRemainingPlaylist, feedbackOptions, type PlaylistFeedback } from "./playlist-feedback";
import {
  assessEmotionalSafety,
  deleteEmotionalHistory,
  saveMinimizedEmotionalHistory,
  type EmotionalSafetyAssessment,
} from "./emotional-safety";

type SessionBootstrap = {
  sessionId: string;
  token: string;
  sharedSecret: string;
  expiresAt: number;
};

type ZeroGWalletInfo = {
  address: string;
  network: string;
  chainId: number;
  explorerUrl: string;
  balance0G: string | null;
};

type ZeroGBackupReceipt = {
  rootHash: string;
  txHash: string | null;
  walletAddress: string;
  network: string;
  createdAt: string;
  sizeBytes: number;
};

type BackupState = "idle" | "loading-wallet" | "review" | "uploading" | "success" | "restoring" | "error";

const initialStatus: PageBridgeStatus = {
  connected: false,
  toolsVersion: 0,
  toolNames: [],
};

const relayUrl = process.env.NEXT_PUBLIC_WEBMCP_BRIDGE_RELAY_URL ?? "wss://relay-webmcpbridge.searchboxlabs.org/v1/ws";
const relayWebOrigin = new URL(
  process.env.NEXT_PUBLIC_WEBMCP_BRIDGE_RELAY_WEB_URL ?? "https://relay-webmcpbridge.searchboxlabs.org",
).origin;

export function PodsOnMarsApp() {
  const [status, setStatus] = useState(initialStatus);
  const [emotionalCheckIn, setEmotionalCheckIn] = useState<EmotionalCheckIn | null>(null);
  const [agentTransition, setAgentTransition] = useState<ReachableStatePlanValue | null>(null);
  const [latestFeedback, setLatestFeedback] = useState<PlaylistFeedback | null>(null);
  const [safetyAssessment, setSafetyAssessment] = useState<EmotionalSafetyAssessment>({ level: "standard", signals: [] });
  const [historyConsent, setHistoryConsent] = useState(false);
  const [savedHistoryCount, setSavedHistoryCount] = useState(0);
  const [checkInResetKey, setCheckInResetKey] = useState(0);
  const [playbackState, setPlaybackState] = useState<"idle" | "requesting" | "playing" | "error">("idle");
  const [playbackMessage, setPlaybackMessage] = useState("Build a playlist with your Agent before playing.");
  const [generationState, setGenerationState] = useState<"idle" | "researching" | "ready" | "error">("idle");
  const [generationMessage, setGenerationMessage] = useState("Share how you feel to let your Agent build the journey.");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [journeyExplanation, setJourneyExplanation] = useState("Your Agent will explain the emotional journey here.");
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [backupState, setBackupState] = useState<BackupState>("idle");
  const [backupMessage, setBackupMessage] = useState("Nothing is backed up unless you explicitly confirm it.");
  const [backupWallet, setBackupWallet] = useState<ZeroGWalletInfo | null>(null);
  const [backupReceipt, setBackupReceipt] = useState<ZeroGBackupReceipt | null>(null);
  const [restoreRootHash, setRestoreRootHash] = useState("");
  const connectionPopup = useRef<Window | null>(null);
  const connectionState = useRef<string | null>(null);
  const playlistRef = useRef(playlist);
  const feedbackRef = useRef<PlaylistFeedback | null>(null);
  const safetyRef = useRef<EmotionalSafetyAssessment>({ level: "standard", signals: [] });
  const historyConsentRef = useRef(false);
  const actionBridgeRef = useRef<PageActionBridge | null>(null);
  const pendingCheckInRef = useRef<EmotionalCheckIn | null>(null);
  const generatedCheckInRef = useRef<string | null>(null);
  const backupWalletBalance = Number(backupWallet?.balance0G ?? Number.NaN);
  const backupWalletIsFunded = Number.isFinite(backupWalletBalance) && backupWalletBalance > 0;

  async function requestPlaylist(checkIn: EmotionalCheckIn) {
    if (!actionBridgeRef.current || !status.connected || safetyRef.current.level === "crisis") return;
    const key = checkIn.emotionalState.capturedAt;
    if (generatedCheckInRef.current === key) return;
    generatedCheckInRef.current = key;
    setGenerationState("researching");
    setGenerationMessage("Your Agent is matching genres to a reachable six-song journey…");
    setPlaylist([]); playlistRef.current = [];
    try {
      const plan = planReachableState(checkIn);
      const result = await actionBridgeRef.current.request("build_emotional_playlist", { checkIn, plan }, 45_000) as {
        items?: unknown; plan?: unknown; explanation?: unknown;
      };
      if (!Array.isArray(result.items) || result.items.length !== 6) throw new Error("The Agent returned an invalid playlist.");
      const stages = ["Recognition", "Companionship", "Release", "Regulation", "Reorientation", "Gentle momentum"];
      const items = result.items.map((value, index): PlaylistItem => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The Agent returned an invalid playlist item.");
        const item = value as Record<string, unknown>;
        if (typeof item.id !== "string" || !item.id || typeof item.title !== "string" || !item.title || typeof item.artist !== "string" || !item.artist || typeof item.note !== "string" || !item.note || item.stage !== stages[index]) throw new Error("The Agent returned an invalid playlist item.");
        return { id: item.id.slice(0, 100), title: item.title.slice(0, 200), artist: item.artist.slice(0, 200), note: item.note.slice(0, 500), stage: item.stage, ...(typeof item.energy === "number" && item.energy >= 0 && item.energy <= 1 ? { energy: item.energy } : {}), ...(Array.isArray(item.themes) ? { themes: item.themes.filter((theme): theme is string => typeof theme === "string").slice(0, 8) } : {}), ...(Array.isArray(item.distressingThemes) ? { distressingThemes: item.distressingThemes.filter((theme): theme is string => typeof theme === "string").slice(0, 8) } : {}) };
      });
      playlistRef.current = items;
      setPlaylist(items);
      if (result.plan && typeof result.plan === "object") setAgentTransition(result.plan as ReachableStatePlanValue);
      if (typeof result.explanation === "string" && result.explanation.length <= 500) setJourneyExplanation(result.explanation);
      setGenerationState("ready");
      setGenerationMessage("Your genre-shaped emotional journey is ready.");
      setPlaybackMessage("Ready to play through the minimized Spotify player.");
    } catch (error) {
      generatedCheckInRef.current = null;
      setGenerationState("error");
      setGenerationMessage(error instanceof Error ? error.message : "The Agent could not build this playlist.");
    }
  }

  function captureCheckIn(checkIn: EmotionalCheckIn) {
    const assessment = assessEmotionalSafety(checkIn);
    safetyRef.current = assessment;
    setSafetyAssessment(assessment);
    setEmotionalCheckIn(checkIn);
    pendingCheckInRef.current = checkIn;
    if (historyConsentRef.current) setSavedHistoryCount(saveMinimizedEmotionalHistory(window.localStorage, checkIn));
    void requestPlaylist(checkIn);
  }

  function clearEmotionalData() {
    deleteEmotionalHistory(window.localStorage);
    setSavedHistoryCount(0);
    setHistoryConsent(false);
    historyConsentRef.current = false;
    setEmotionalCheckIn(null);
    setCheckInResetKey((current) => current + 1);
    setAgentTransition(null);
    setLatestFeedback(null);
    feedbackRef.current = null;
    safetyRef.current = { level: "standard", signals: [] };
    setSafetyAssessment(safetyRef.current);
  }

  useEffect(() => {
    function receiveConnection(event: MessageEvent) {
      if (event.origin !== relayWebOrigin) return;
      if (!connectionPopup.current || event.source !== connectionPopup.current) return;
      const value = event.data as Partial<{ type: string; state: string; sessionId: string; token: string; sharedSecret: string; expiresAt: number }>;
      if (value.type !== "WEBMCP_BRIDGE_CONNECTED" || !value.sessionId || !value.token || !value.sharedSecret ||
          value.state !== connectionState.current || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now() ||
          value.expiresAt > Date.now() + 10 * 60_000) return;
      connectionPopup.current = null;
      connectionState.current = null;
      sessionStorage.setItem("webmcp-bridge-bootstrap", JSON.stringify({
        sessionId: value.sessionId, token: value.token, sharedSecret: value.sharedSecret, expiresAt: value.expiresAt,
      }));
      window.location.assign(`/?session=${encodeURIComponent(value.sessionId)}`);
    }
    window.addEventListener("message", receiveConnection);
    return () => window.removeEventListener("message", receiveConnection);
  }, []);

  function openAgentConnection() {
    const popupUrl = new URL("/connect", relayWebOrigin);
    const state = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
      .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    popupUrl.searchParams.set("app_origin", window.location.origin);
    popupUrl.searchParams.set("state", state);
    if (connectionPopup.current && !connectionPopup.current.closed) connectionPopup.current.close();
    const popup = window.open(popupUrl, "webmcp-bridge-connect", "popup,width=520,height=700,resizable=yes,scrollbars=yes");
    if (!popup) {
      connectionState.current = null;
      setStatus({ ...initialStatus, error: "Allow popups to connect your Agent." });
      return;
    }
    connectionState.current = state;
    connectionPopup.current = popup;
  }

  function applyFeedback(feedback: PlaylistFeedback) {
    const next = adaptRemainingPlaylist(playlistRef.current, feedback);
    playlistRef.current = next;
    setPlaylist(next);
    feedbackRef.current = feedback;
    setLatestFeedback(feedback);
  }

  async function requestPlayback() {
    if (safetyRef.current.level === "crisis") {
      setPlaybackState("error");
      setPlaybackMessage("Playback is paused because this check-in may need immediate human support.");
      return;
    }
    if (!actionBridgeRef.current || !status.connected) {
      setPlaybackState("error");
      setPlaybackMessage("Connect your Agent before playing.");
      return;
    }
    if (playlistRef.current.length === 0) {
      setPlaybackState("error");
      setPlaybackMessage("Build a playlist with your Agent before playing.");
      return;
    }
    setPlaybackState("requesting");
    setPlaybackMessage("Resolving this playlist in your Spotify market…");
    try {
      await actionBridgeRef.current.notify("play_emotional_playlist", {
        playlist: playlistRef.current.map(({ id, title, artist }) => ({ id, title, artist })),
      });
      setPlaybackState("playing");
      setPlaybackMessage("Playback request accepted. Starting the minimized Spotify player…");
    } catch (error) {
      setPlaybackState("error");
      setPlaybackMessage(error instanceof Error ? error.message : "Spotify playback could not start.");
    }
  }

  function minimizedCheckpoint() {
    if (!emotionalCheckIn) throw new Error("Complete an emotional check-in before creating a backup.");
    const transition = agentTransition ?? planReachableState(emotionalCheckIn);
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      emotionalState: {
        emotions: emotionalCheckIn.emotionalState.emotions,
        valence: emotionalCheckIn.emotionalState.valence,
        arousal: emotionalCheckIn.emotionalState.arousal,
        capturedAt: emotionalCheckIn.emotionalState.capturedAt,
      },
      listeningMinutes: emotionalCheckIn.listeningMinutes,
      transitionSpeed: emotionalCheckIn.transitionSpeed,
      transition,
      playlist: playlistRef.current.map(({ id, title, artist, note, stage, energy, themes }) => ({
        id, title, artist, note, ...(stage ? { stage } : {}), ...(energy === undefined ? {} : { energy }), ...(themes ? { themes } : {}),
      })),
      latestFeedback: feedbackRef.current,
    };
  }

  async function beginBackupReview() {
    if (!actionBridgeRef.current || !status.connected) {
      setBackupState("error");
      setBackupMessage("Connect your Agent before preparing a backup.");
      return;
    }
    try {
      minimizedCheckpoint();
      setBackupState("loading-wallet");
      setBackupMessage("Loading the runtime's 0G funding address…");
      const wallet = await actionBridgeRef.current.request("get_0g_backup_wallet", {}, 20_000) as ZeroGWalletInfo;
      if (!/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) throw new Error("The runtime returned an invalid 0G wallet address.");
      setBackupWallet(wallet);
      setBackupState("review");
      const balance = Number(wallet.balance0G ?? Number.NaN);
      if (!Number.isFinite(balance) || balance < 0) throw new Error("The runtime returned an invalid 0G wallet balance.");
      setBackupMessage(balance > 0
        ? "Review what is included, then confirm the encrypted upload."
        : "This runtime wallet is unfunded. Send 0G on 0G Mainnet before confirming a backup.");
    } catch (error) {
      setBackupState("error");
      setBackupMessage(error instanceof Error ? error.message : "The runtime could not prepare the backup.");
    }
  }

  async function confirmBackup() {
    if (!actionBridgeRef.current || !status.connected) return;
    try {
      const checkpoint = minimizedCheckpoint();
      setBackupState("uploading");
      setBackupMessage("Checking the wallet balance, then encrypting locally and uploading to 0G…");
      const receipt = await actionBridgeRef.current.request("create_encrypted_0g_backup", {
        consent: true,
        checkpoint,
      }, 180_000) as ZeroGBackupReceipt;
      if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.rootHash)) throw new Error("0G returned an invalid root hash.");
      setBackupReceipt(receipt);
      setBackupState("success");
      setBackupMessage("Encrypted backup stored. Keep the root hash and this runtime's local key file to restore it.");
    } catch (error) {
      setBackupState("error");
      setBackupMessage(error instanceof Error ? error.message : "The encrypted 0G backup failed.");
    }
  }

  async function restoreBackup() {
    if (!actionBridgeRef.current || !status.connected) {
      setBackupState("error");
      setBackupMessage("Connect the same Agent runtime before restoring.");
      return;
    }
    const rootHash = restoreRootHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(rootHash)) {
      setBackupState("error");
      setBackupMessage("Enter a valid 0G root hash.");
      return;
    }
    try {
      setBackupState("restoring");
      setBackupMessage("Downloading, authenticating, and decrypting the checkpoint in your runtime…");
      const result = await actionBridgeRef.current.request("restore_encrypted_0g_backup", { rootHash }, 120_000) as {
        checkpoint?: Record<string, unknown>;
      };
      const checkpoint = result.checkpoint;
      if (!checkpoint || typeof checkpoint !== "object" || !checkpoint.emotionalState || !Array.isArray(checkpoint.playlist)) {
        throw new Error("The runtime returned an invalid restored checkpoint.");
      }
      const restoredCheckIn: EmotionalCheckIn = {
        emotionalState: checkpoint.emotionalState as EmotionalCheckIn["emotionalState"],
        listeningMinutes: checkpoint.listeningMinutes as EmotionalCheckIn["listeningMinutes"],
        transitionSpeed: checkpoint.transitionSpeed as EmotionalCheckIn["transitionSpeed"],
      };
      const restoredPlaylist = checkpoint.playlist as PlaylistItem[];
      setEmotionalCheckIn(restoredCheckIn);
      pendingCheckInRef.current = null;
      generatedCheckInRef.current = restoredCheckIn.emotionalState.capturedAt;
      playlistRef.current = restoredPlaylist;
      setPlaylist(restoredPlaylist);
      if (checkpoint.transition && typeof checkpoint.transition === "object") setAgentTransition(checkpoint.transition as ReachableStatePlanValue);
      if (typeof checkpoint.latestFeedback === "string") {
        feedbackRef.current = checkpoint.latestFeedback as PlaylistFeedback;
        setLatestFeedback(checkpoint.latestFeedback as PlaylistFeedback);
      } else {
        feedbackRef.current = null;
        setLatestFeedback(null);
      }
      setBackupState("success");
      setBackupMessage("The encrypted checkpoint was restored into this tab.");
    } catch (error) {
      setBackupState("error");
      setBackupMessage(error instanceof Error ? error.message : "The encrypted 0G backup could not be restored.");
    }
  }

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) {
      setStatus({ ...initialStatus, error: "This browser cannot connect to your listening agent." });
      return;
    }

    const registration = new AbortController();
    let stopRuntime: (() => void) | undefined;
    let transport: ClosableBridgeTransport | undefined;
    let actionBridge: PageActionBridge | undefined;
    let disposed = false;

    async function initialize() {
      const tools = createPodsOnMarsTools({
        captureCheckIn,
        setTransition(plan) { setAgentTransition(plan); },
        setPlaylist(items) { playlistRef.current = items; setPlaylist(items); },
        addPlaylistItem(item) {
          if (playlistRef.current.some(({ id }) => id === item.id)) throw new TypeError(`Playlist item ${item.id} already exists.`);
          playlistRef.current = [...playlistRef.current, item];
          setPlaylist(playlistRef.current);
        },
        replacePlaylistItem(id, item) {
          const index = playlistRef.current.findIndex((current) => current.id === id);
          if (index === -1) return false;
          if (item.id !== id && playlistRef.current.some((current) => current.id === item.id)) throw new TypeError(`Playlist item ${item.id} already exists.`);
          playlistRef.current = playlistRef.current.map((current, currentIndex) => currentIndex === index ? item : current);
          setPlaylist(playlistRef.current);
          return true;
        },
        annotateSong(title, artist, note) {
          playlistRef.current = playlistRef.current.map((item) => item.title === title && item.artist === artist ? { ...item, note } : item);
          setPlaylist(playlistRef.current);
        },
        explainJourney(explanation) { setJourneyExplanation(explanation); },
        playPlaylist() {
          if (safetyRef.current.level === "crisis") {
            throw new Error("Playlist playback is paused because this check-in may need immediate human support.");
          }
          const first = playlistRef.current[0];
          return first;
        },
        readFeedback() { return { feedback: feedbackRef.current, remaining: playlistRef.current.slice(1) }; },
        planTrack(track, artist, mood) {
          const item = { id: `legacy-${Date.now()}`, title: track, artist, note: mood };
          playlistRef.current = [item];
          setPlaylist([item]);
        },
      });
      for (const tool of tools) {
        await modelContext!.registerTool(tool, { signal: registration.signal });
      }

      if (disposed) return;
      const sessionId =
        new URLSearchParams(window.location.search).get("session")?.match(/^[A-Za-z0-9_-]{1,64}$/)?.[0] ??
        "demo";
      const bootstrapRaw = sessionStorage.getItem("webmcp-bridge-bootstrap");
      let bootstrap: SessionBootstrap | null = null;
      if (bootstrapRaw) {
        const candidate = JSON.parse(bootstrapRaw) as Partial<SessionBootstrap>;
        if (typeof candidate.sessionId === "string" && typeof candidate.token === "string" &&
            typeof candidate.sharedSecret === "string" && typeof candidate.expiresAt === "number" &&
            candidate.expiresAt > Date.now() && candidate.expiresAt <= Date.now() + 10 * 60_000) {
          bootstrap = candidate as SessionBootstrap;
        } else {
          sessionStorage.removeItem("webmcp-bridge-bootstrap");
        }
      }
      const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
      const pairedSession = /^session_[A-Za-z0-9_]+$/.test(sessionId);
      const pairedBootstrap = bootstrap?.sessionId === sessionId && bootstrap.expiresAt > Date.now() ? bootstrap : null;
      if (pairedSession && !pairedBootstrap) {
        throw new Error("Missing encrypted session bootstrap for this paired runtime session.");
      }
      const token = pairedBootstrap?.token ?? fragmentToken;
      if (sessionId === "demo" && !token) {
        setStatus({ ...initialStatus, error: undefined });
        return;
      }
      if (!token || token.length < 32 || token.length > 256) {
        throw new Error(
          "Missing session token. Open this page with #token=<32-256 character session token>.",
        );
      }

      setActiveSessionId(sessionId);
      const relayTransport = createWebSocketTransport({
        url: relayUrl,
        sessionId,
        source: "page",
        token,
      });
      transport = pairedBootstrap
        ? await createEncryptedTransport({ transport: relayTransport, sessionId, source: "page", sharedSecret: pairedBootstrap.sharedSecret })
        : relayTransport;
      actionBridge = await connectPageActionBridge(transport);
      actionBridgeRef.current = actionBridge;
      stopRuntime = await startPageBridge({
        modelContext: modelContext as unknown as WebMcpModelContext,
        transport,
        onStatus: setStatus,
      });
    }

    void initialize().catch((error: unknown) => {
      if (disposed && error instanceof DOMException && error.name === "AbortError") return;
      setStatus({
        ...initialStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      disposed = true;
      stopRuntime?.();
      actionBridge?.close();
      if (actionBridgeRef.current === actionBridge) actionBridgeRef.current = null;
      transport?.close();
      registration.abort();
    };
  }, []);

  const connected = status.connected && Boolean(activeSessionId);
  useEffect(() => {
    if (connected && pendingCheckInRef.current) void requestPlaylist(pendingCheckInRef.current);
  }, [connected]);
  const currentStatus = status.error
    ? "Connection needs attention"
    : connected
      ? "Agent ready"
      : "Awaiting secure pairing";
  const statusToneClass = status.error
    ? "pods-status pods-status-error"
    : connected
      ? "pods-status pods-status-live"
      : "pods-status pods-status-pending";
  const connectButtonLabel = connected ? "Connected" : "Connect Agent";
  return (
    <main className="podcast-page">
      <div className="podcast-page-inner">
        <header className="pods-header">
          <div className="pods-topline">
            <p>© 2026 Pods On Mars / daily soundtrack intelligence</p>
            <p>Made for the in-between</p>
          </div>

          <div className="pods-nav">
            <Link className="pods-brand" href="/">
              <span className="pods-brand-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>Pods On Mars</span>
            </Link>

            <div className="pods-nav-actions">
              <Link className="pods-setup-link" href="/setup">Setup</Link>
              <div className={statusToneClass} aria-live="polite">
                <span className="pods-status-dot" aria-hidden="true" />
                <span>{currentStatus}</span>
              </div>
              <button
                type="button"
                className="pods-connect-button"
                onClick={openAgentConnection}
                disabled={connected}
              >
                {connectButtonLabel}
              </button>
            </div>
          </div>
        </header>

        <section className="pods-hero">
          <div className="pods-hero-copy">
            <div className="pods-section-tag">
              <span>01</span>
              <span>Atmosphere, composed</span>
            </div>

            <h1 aria-label="Pods On Mars - FM">
              How do you want
              <span>the room</span>
              to feel?
            </h1>

            <p className="podcast-description">
              Describe the mood, shape the playlist, and let your paired agent keep adding
              the right next song without leaving the room.
            </p>

          </div>
        </section>

        <EmotionalStatePicker key={checkInResetKey} onCapture={captureCheckIn} />

        <section className="emotion-safety-boundary" aria-label="Music support boundary">
          <p><strong>Music can accompany this moment.</strong> It does not diagnose or treat a medical condition.</p>
        </section>

        {safetyAssessment.level === "crisis" ? (
          <section className="emotion-crisis-notice" role="alert" aria-labelledby="emotion-crisis-title">
            <p className="emotion-kicker">Immediate human support matters</p>
            <h2 id="emotion-crisis-title">A playlist is not enough for this moment.</h2>
            <p>If you may act on thoughts of harming yourself or someone else, contact local emergency services or a crisis line now. If possible, stay with someone you trust while you seek help.</p>
          </section>
        ) : null}

        {emotionalCheckIn ? (
          <>
            <section className="emotion-snapshot" aria-live="polite" aria-label="Captured emotional state">
              <div>
                <p>Your listening direction</p>
                <strong>{emotionalCheckIn.emotionalState.emotions.map(({ name }) => name).join(" + ")}</strong>
              </div>
              <span>{emotionalCheckIn.listeningMinutes} minutes · {emotionalCheckIn.transitionSpeed} transition</span>
            </section>
            <ReachableStatePlan plan={agentTransition ?? planReachableState(emotionalCheckIn)} />
            <section className="emotion-privacy-controls" aria-labelledby="emotion-privacy-title">
              <div>
                <h2 id="emotion-privacy-title">Your check-in stays temporary</h2>
                <p>It is kept in this tab only. Saving is optional, limited to 10 check-ins, and never includes what you wrote in the context box.</p>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={historyConsent}
                  onChange={(event) => {
                    historyConsentRef.current = event.target.checked;
                    setHistoryConsent(event.target.checked);
                  }}
                />
                Save future check-ins on this device
              </label>
              <button type="button" onClick={clearEmotionalData}>Delete emotional data now</button>
              <p aria-live="polite">{savedHistoryCount > 0 ? `${savedHistoryCount} minimized check-in${savedHistoryCount === 1 ? "" : "s"} saved.` : "No emotional history is saved."}</p>
            </section>
          </>
        ) : null}

        <section className="zero-g-backup" aria-labelledby="zero-g-backup-title">
          <div className="zero-g-backup-heading">
            <div>
              <p className="emotion-kicker">Optional durable backup</p>
              <h2 id="zero-g-backup-title">Encrypted on your runtime, stored on 0G</h2>
            </div>
            <button
              type="button"
              onClick={beginBackupReview}
              disabled={!connected || !emotionalCheckIn || backupState === "loading-wallet" || backupState === "uploading" || backupState === "restoring"}
            >
              {backupState === "loading-wallet" ? "Preparing…" : "Back up this session"}
            </button>
          </div>
          <p>Your natural-language context, Spotify credentials, passkeys, wallet keys, and complete lyrics are excluded. No automatic backups occur.</p>

          {backupState === "review" && backupWallet ? (
            <div className="zero-g-backup-review" role="group" aria-label="Confirm 0G backup">
              <p><strong>Included:</strong> emotion labels and intensity, transition plan, minimized playlist, and latest feedback.</p>
              <p><strong>0G funding address:</strong> <code>{backupWallet.address}</code></p>
              <p><strong>Current balance:</strong> {backupWallet.balance0G ?? "Unavailable"} 0G</p>
              <p><strong>Network:</strong> {backupWallet.network} · storage and gas use real 0G funds.</p>
              <p><a href={backupWallet.explorerUrl} target="_blank" rel="noreferrer">Open the official 0G Mainnet explorer</a></p>
              <div>
                <button type="button" onClick={confirmBackup} disabled={!backupWalletIsFunded}>Confirm encrypted backup</button>
                <button type="button" onClick={() => { setBackupState("idle"); setBackupMessage("Backup cancelled. Nothing was uploaded."); }}>Cancel</button>
              </div>
            </div>
          ) : null}

          {backupReceipt ? (
            <div className="zero-g-backup-receipt" aria-label="0G backup receipt">
              <strong>0G root hash</strong>
              <code>{backupReceipt.rootHash}</code>
              <span>{backupReceipt.network} · {backupReceipt.sizeBytes} encrypted bytes</span>
            </div>
          ) : null}

          <div className="zero-g-restore">
            <label htmlFor="zero-g-root-hash">Restore with a 0G root hash</label>
            <div>
              <input
                id="zero-g-root-hash"
                type="text"
                spellCheck={false}
                autoComplete="off"
                value={restoreRootHash}
                onChange={(event) => setRestoreRootHash(event.target.value)}
                placeholder="0x…"
              />
              <button type="button" onClick={restoreBackup} disabled={!connected || backupState === "uploading" || backupState === "restoring"}>
                {backupState === "restoring" ? "Restoring…" : "Restore"}
              </button>
            </div>
          </div>
          <p className={`zero-g-backup-status is-${backupState}`} role={backupState === "error" ? "alert" : "status"}>{backupMessage}</p>
        </section>

        <section className="pods-grid pods-playlist-grid" aria-label="Your emotional playlist">
          <aside className="pods-column pods-side-panel">
            <div className="pods-section-tag">
              <span>02 / Playlist</span>
              <span>Your next songs</span>
            </div>

            <section className="page-runtime-panel" aria-live="polite">
              <div className="page-runtime-intro">
                <div className="page-runtime-icon" aria-hidden="true">✦</div>
                <div>
                  <p className="page-runtime-label">Listening connection</p>
                  <p className={status.connected ? "page-runtime-ready" : "page-runtime-waiting"}>
                    {status.connected && activeSessionId ? "Ready to shape your playlist." : "Connect when you are ready for recommendations."}
                  </p>
                </div>
              </div>

              <section className="pods-playlist-panel" aria-label="Generated playlist">
                <div className="pods-playlist-heading">
                  <div>
                    <p className="page-runtime-label">Playlist queue</p>
                    <h3>{playlist.length > 0 ? "Your emotional journey" : "No songs yet"}</h3>
                  </div>
                  <button type="button" onClick={requestPlayback} disabled={playbackState === "requesting" || playlist.length === 0 || !connected}>
                    {playbackState === "requesting" ? "Starting…" : "Play in Spotify"}
                  </button>
                </div>

                <p className={`pods-playback-status is-${generationState === "error" ? "error" : generationState === "ready" ? "playing" : "requesting"}`} role={generationState === "error" ? "alert" : "status"}>{generationMessage}</p>
                {playlist.length > 0 ? <ul className="pods-playlist-list">
                  {playlist.map((item, index) => (
                    <li key={item.id}>
                      <div>
                        <strong>{index + 1}. {item.title}</strong>
                        <p>{item.artist}</p>
                      </div>
                      <span>{item.stage ? `${item.stage} · ` : ""}{item.note}</span>
                    </li>
                  ))}
                </ul> : <p className="pods-playlist-empty">Share how you feel, connect your Agent, and ask it to build the journey.</p>}

                <p className={`pods-playback-status is-${playbackState}`} role={playbackState === "error" ? "alert" : "status"}>{playbackMessage}</p>
                <p className="pods-journey-explanation">{journeyExplanation}</p>

                {playlist.length > 0 ? <div className="pods-feedback" aria-label="Adjust the remaining playlist">
                  <p className="page-runtime-label">How is this landing?</p>
                  <div className="pods-feedback-options">
                    {feedbackOptions.map((feedback) => (
                      <button key={feedback} type="button" aria-pressed={latestFeedback === feedback} onClick={() => applyFeedback(feedback)}>
                        {feedback}
                      </button>
                    ))}
                  </div>
                  <p className="pods-feedback-status" aria-live="polite">
                    {latestFeedback ? `Applied to what comes next: ${latestFeedback}.` : "Choose only when the journey needs adjusting."}
                  </p>
                </div> : null}
              </section>

              {status.error ? <p className="page-runtime-error">{status.error}</p> : null}
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
