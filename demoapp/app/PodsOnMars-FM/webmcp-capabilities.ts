import type { EmotionalCheckIn } from "./emotional-state";
import type { ReachableStatePlan } from "./reachable-state-planner";

export type PlaylistItem = { id: string; title: string; artist: string; note: string; stage?: string; energy?: number; themes?: string[]; distressingThemes?: string[] };
type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent: unknown };
type ToolDefinition = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
};

export type CapabilityHandlers = {
  captureCheckIn: (checkIn: EmotionalCheckIn) => void;
  setTransition: (plan: ReachableStatePlan) => void;
  setPlaylist: (items: PlaylistItem[]) => void;
  addPlaylistItem: (item: PlaylistItem) => void;
  replacePlaylistItem: (id: string, item: PlaylistItem) => boolean;
  annotateSong: (title: string, artist: string, note: string) => void;
  explainJourney: (explanation: string) => void;
  playPlaylist: () => PlaylistItem | undefined;
  readFeedback: () => { feedback: string | null; remaining: PlaylistItem[] };
  planTrack: (track: string, artist: string, mood: string) => void;
};

const stages = ["Recognition", "Companionship", "Release", "Regulation", "Reorientation", "Gentle momentum"];
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const stringField = (description: string) => ({ type: "string", minLength: 1, maxLength: 500, description });
const text = (message: string, structuredContent: unknown): ToolResult => ({ content: [{ type: "text", text: message }], structuredContent });
const requiredString = (input: Record<string, unknown>, key: string, maximum = 500) => {
  const value = typeof input[key] === "string" ? input[key].trim() : "";
  if (!value || value.length > maximum) throw new TypeError(`${key} must contain 1–${maximum} characters.`);
  return value;
};
const bounded = (input: Record<string, unknown>, key: string, minimum: number, maximum: number) => {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${key} must be from ${minimum} to ${maximum}.`);
  return value;
};
const stringList = (input: Record<string, unknown>, key: string, maximum = 12) => {
  const value = input[key];
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 100)) throw new TypeError(`${key} must contain at most ${maximum} short labels.`);
  return value.map((item) => String(item).trim());
};
const attributedSources = (value: unknown) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new TypeError("sources must contain 1–8 attributed HTTPS sources.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new TypeError("Each source must be an object.");
    const source = item as Record<string, unknown>;
    const title = requiredString(source, "title", 200);
    if (typeof source.url !== "string") throw new TypeError("Each source requires a URL.");
    const url = new URL(source.url);
    if (url.protocol !== "https:") throw new TypeError("Source URLs must use HTTPS.");
    return { title, url: url.href };
  });
};
const playlistItem = (value: unknown): PlaylistItem => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("playlist item must be an object.");
  const input = value as Record<string, unknown>;
  const item = { id: requiredString(input, "id", 100), title: requiredString(input, "title", 200), artist: requiredString(input, "artist", 200), note: requiredString(input, "note", 500), ...(typeof input.stage === "string" && stages.includes(input.stage) ? { stage: input.stage } : {}), ...(input.energy === undefined ? {} : { energy: bounded(input, "energy", 0, 1) }), ...(input.themes === undefined ? {} : { themes: stringList(input, "themes", 8) }), ...(input.distressingThemes === undefined ? {} : { distressingThemes: stringList(input, "distressingThemes", 8) }) };
  return item;
};

export function createPodsOnMarsTools(handlers: CapabilityHandlers): ToolDefinition[] {
  const songFields = { title: stringField("Song title."), artist: stringField("Artist name.") };
  return [
    {
      name: "capture_emotional_state", title: "Capture emotional state", description: "Record the listener's explicit emotional check-in. Does not infer feelings or access the page DOM.",
      inputSchema: objectSchema({ emotions: { type: "array", minItems: 1, maxItems: 8, items: objectSchema({ name: stringField("Emotion name."), intensity: { type: "number", minimum: 0, maximum: 1 } }, ["name", "intensity"]) }, valence: { type: "number", minimum: -1, maximum: 1 }, arousal: { type: "number", minimum: 0, maximum: 1 }, context: stringField("Optional listener-provided context."), listeningMinutes: { type: "number", enum: [15, 30, 45, 60] }, transitionSpeed: { type: "string", enum: ["gradual", "balanced", "direct"] } }, ["emotions", "valence", "arousal", "listeningMinutes", "transitionSpeed"]),
      execute: async (input) => {
        if (!Array.isArray(input.emotions) || input.emotions.length < 1 || input.emotions.length > 8) throw new TypeError("emotions must contain 1–8 entries.");
        const emotions = input.emotions.map((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Each emotion must be an object.");
          const emotion = value as Record<string, unknown>;
          return { name: requiredString(emotion, "name", 80), intensity: bounded(emotion, "intensity", 0, 1) };
        });
        const listeningMinutes = bounded(input, "listeningMinutes", 15, 60);
        if (![15, 30, 45, 60].includes(listeningMinutes)) throw new TypeError("listeningMinutes must be 15, 30, 45, or 60.");
        const transitionSpeed = input.transitionSpeed;
        if (!["gradual", "balanced", "direct"].includes(String(transitionSpeed))) throw new TypeError("Invalid transitionSpeed.");
        const checkIn: EmotionalCheckIn = { emotionalState: { emotions, valence: bounded(input, "valence", -1, 1), arousal: bounded(input, "arousal", 0, 1), ...(typeof input.context === "string" && input.context.trim() ? { context: input.context.trim().slice(0, 500) } : {}), capturedAt: new Date().toISOString() }, listeningMinutes: listeningMinutes as EmotionalCheckIn["listeningMinutes"], transitionSpeed: transitionSpeed as EmotionalCheckIn["transitionSpeed"] };
        handlers.captureCheckIn(checkIn);
        return text("Captured the listener's emotional state for this session.", {
          emotionalState: {
            emotions: checkIn.emotionalState.emotions,
            valence: checkIn.emotionalState.valence,
            arousal: checkIn.emotionalState.arousal,
            capturedAt: checkIn.emotionalState.capturedAt,
          },
          listeningMinutes: checkIn.listeningMinutes,
          transitionSpeed: checkIn.transitionSpeed,
          contextRetained: false,
        });
      },
    },
    {
      name: "plan_emotional_transition", title: "Plan emotional transition", description: "Display a reachable emotional transition chosen by the agent.",
      inputSchema: objectSchema({ current: stringField("Current emotional state."), next: stringField("Next reachable state."), destination: stringField("Longer-term destination."), transitionIntensity: { type: "string", enum: ["gentle", "moderate", "strong"] }, transitionMinutes: { type: "number", minimum: 5, maximum: 60 }, totalMinutes: { type: "number", minimum: 15, maximum: 60 } }, ["current", "next", "destination", "transitionIntensity", "transitionMinutes", "totalMinutes"]),
      execute: async (input) => {
        const intensity = input.transitionIntensity;
        if (!["gentle", "moderate", "strong"].includes(String(intensity))) throw new TypeError("Invalid transitionIntensity.");
        const plan: ReachableStatePlan = { current: requiredString(input, "current", 200), next: requiredString(input, "next", 200), destination: requiredString(input, "destination", 200), transitionIntensity: intensity as ReachableStatePlan["transitionIntensity"], transitionMinutes: bounded(input, "transitionMinutes", 5, 60), totalMinutes: bounded(input, "totalMinutes", 15, 60) };
        if (plan.transitionMinutes > plan.totalMinutes) throw new TypeError("transitionMinutes cannot exceed totalMinutes.");
        handlers.setTransition(plan);
        return text(`Planned a ${plan.transitionIntensity} transition toward ${plan.next}.`, plan);
      },
    },
    {
      name: "research_song_context", title: "Publish song context", description: "Attach an attributed research summary produced outside the browser. This tool performs no network access.",
      inputSchema: objectSchema({ ...songFields, summary: stringField("Derived summary only; never raw lyrics."), sources: { type: "array", minItems: 1, maxItems: 8, items: objectSchema({ title: stringField("Source title."), url: { type: "string", format: "uri", pattern: "^https://" } }, ["title", "url"]) } }, ["title", "artist", "summary", "sources"]),
      execute: async (input) => {
        const title = requiredString(input, "title", 200); const artist = requiredString(input, "artist", 200); const summary = requiredString(input, "summary", 500);
        const sources = attributedSources(input.sources);
        handlers.annotateSong(title, artist, summary);
        return text(`Added attributed context for ${title}.`, { title, artist, summary, sources });
      },
    },
    {
      name: "analyze_song_lyrics", title: "Publish lyrics analysis", description: "Attach derived lyrics-analysis fields produced outside the browser. The schema has no raw-lyrics field.",
      inputSchema: objectSchema({ ...songFields, themes: { type: "array", maxItems: 12, items: stringField("Derived theme label.") }, emotionalTone: { type: "array", maxItems: 12, items: stringField("Derived emotional-tone label.") }, emotionalProgression: { type: "array", maxItems: 6, items: stringField("Derived progression label.") }, potentiallyDistressingThemes: { type: "array", maxItems: 12, items: stringField("Distress label.") }, hopefulElements: { type: "array", maxItems: 12, items: stringField("Hopeful-element label.") }, confidence: { type: "number", minimum: 0, maximum: 1 }, sources: { type: "array", minItems: 1, maxItems: 8, items: objectSchema({ title: stringField("Source title."), url: { type: "string", format: "uri", pattern: "^https://" } }, ["title", "url"]) } }, ["title", "artist", "themes", "emotionalTone", "emotionalProgression", "potentiallyDistressingThemes", "hopefulElements", "confidence", "sources"]),
      execute: async (input) => {
        const title = requiredString(input, "title", 200); const artist = requiredString(input, "artist", 200);
        const themes = stringList(input, "themes"); const emotionalTone = stringList(input, "emotionalTone"); const emotionalProgression = stringList(input, "emotionalProgression", 6); const potentiallyDistressingThemes = stringList(input, "potentiallyDistressingThemes"); const hopefulElements = stringList(input, "hopefulElements"); const confidence = bounded(input, "confidence", 0, 1); const sources = attributedSources(input.sources);
        const note = [...emotionalTone, ...themes].slice(0, 3).join(", ") || "Emotionally ambiguous";
        handlers.annotateSong(title, artist, note);
        return text(`Added derived lyrics analysis for ${title}.`, { title, artist, themes, emotionalTone, emotionalProgression, potentiallyDistressingThemes, hopefulElements, confidence, sources });
      },
    },
    {
      name: "build_emotional_playlist", title: "Build emotional playlist", description: "Replace the visible queue with a structured emotional journey.",
      inputSchema: objectSchema({ items: { type: "array", minItems: 1, maxItems: 30, items: objectSchema({ id: stringField("Stable item ID."), title: stringField("Song title."), artist: stringField("Artist."), note: stringField("Placement explanation."), stage: { type: "string", enum: stages }, energy: { type: "number", minimum: 0, maximum: 1 }, themes: { type: "array", maxItems: 8, items: stringField("Theme label.") }, distressingThemes: { type: "array", maxItems: 8, items: stringField("Distressing-theme label.") } }, ["id", "title", "artist", "note"]) } }, ["items"]),
      execute: async (input) => { if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 30) throw new TypeError("items must contain 1–30 songs."); const items = input.items.map(playlistItem); if (new Set(items.map(({ id }) => id)).size !== items.length) throw new TypeError("Playlist item IDs must be unique."); handlers.setPlaylist(items); return text(`Built a ${items.length}-song emotional playlist.`, { items }); },
    },
    {
      name: "add_song_to_playlist", title: "Add song to playlist", description: "Add one structured song to the end of the browser-owned queue.",
      inputSchema: objectSchema({ item: objectSchema({ id: stringField("Stable item ID."), title: stringField("Song title."), artist: stringField("Artist."), note: stringField("Placement explanation."), stage: { type: "string", enum: stages } }, ["id", "title", "artist", "note"]) }, ["item"]),
      execute: async (input) => { const item = playlistItem(input.item); handlers.addPlaylistItem(item); return text(`Added ${item.title} by ${item.artist}.`, item); },
    },
    {
      name: "replace_playlist_song", title: "Replace playlist song", description: "Replace one queue item by its stable browser-visible ID.",
      inputSchema: objectSchema({ id: stringField("Existing playlist item ID."), replacement: objectSchema({ id: stringField("Replacement item ID."), title: stringField("Song title."), artist: stringField("Artist."), note: stringField("Placement explanation."), stage: { type: "string", enum: stages } }, ["id", "title", "artist", "note"]) }, ["id", "replacement"]),
      execute: async (input) => { const id = requiredString(input, "id", 100); const replacement = playlistItem(input.replacement); if (!handlers.replacePlaylistItem(id, replacement)) throw new Error(`Playlist item ${id} is no longer available.`); return text(`Replaced ${id} with ${replacement.title}.`, replacement); },
    },
    {
      name: "explain_playlist_journey", title: "Explain playlist journey", description: "Display a concise explanation of the playlist's emotional arc.",
      inputSchema: objectSchema({ explanation: stringField("Concise explanation of the emotional sequence.") }, ["explanation"]),
      execute: async (input) => { const explanation = requiredString(input, "explanation", 500); handlers.explainJourney(explanation); return text("Displayed the playlist journey explanation.", { explanation }); },
    },
    {
      name: "play_emotional_playlist", title: "Play emotional playlist", description: "Request playback of the current browser-owned playlist. The page retains final execution authority and exposes no Spotify credentials or controls.",
      inputSchema: objectSchema({}, []),
      execute: async () => { const first = handlers.playPlaylist(); if (!first) throw new Error("The playlist is empty. Build it before requesting playback."); return text(`Prepared ${first.title} by ${first.artist} as the playlist lead.`, { first, authority: "browser" }); },
    },
    {
      name: "read_playlist_feedback", title: "Read playlist feedback", description: "Read the listener's latest explicit feedback and the remaining structured queue. Exposes no DOM or browser-control access.",
      inputSchema: objectSchema({}, []),
      execute: async () => { const state = handlers.readFeedback(); return text(state.feedback ? `Latest listener feedback: ${state.feedback}.` : "The listener has not provided playback feedback yet.", state); },
    },
    {
      name: "plan_daily_soundtrack", title: "Plan daily soundtrack", description: "Compatibility capability for planning one visible track without direct Spotify control.",
      inputSchema: objectSchema({ track: stringField("Track title."), artist: stringField("Track artist."), mood: stringField("Mood or listening context.") }, ["track", "artist", "mood"]),
      execute: async (input) => { const track = requiredString(input, "track", 200); const artist = requiredString(input, "artist", 200); const mood = requiredString(input, "mood", 200); handlers.planTrack(track, artist, mood); return text(`Planned ${track} by ${artist} for ${mood}.`, { track, artist, mood }); },
    },
  ];
}
