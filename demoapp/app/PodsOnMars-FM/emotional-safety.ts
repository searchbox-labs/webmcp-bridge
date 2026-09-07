import type { EmotionalCheckIn } from "./emotional-state";

export type EmotionalSafetyAssessment = {
  level: "standard" | "crisis";
  signals: Array<"self-harm" | "suicide" | "harm-to-others" | "immediate-danger">;
};

export type RetainedEmotionalState = {
  emotions: EmotionalCheckIn["emotionalState"]["emotions"];
  valence: number;
  arousal: number;
  capturedAt: string;
  listeningMinutes: EmotionalCheckIn["listeningMinutes"];
  transitionSpeed: EmotionalCheckIn["transitionSpeed"];
};

export const emotionalHistoryStorageKey = "pods-on-mars-emotional-history-v1";
export const emotionalHistoryLimit = 10;

const signalPatterns: Array<[EmotionalSafetyAssessment["signals"][number], RegExp]> = [
  ["suicide", /\b(kill myself|end my life|die by suicide|commit suicide|suicidal|no reason to live)\b/i],
  ["self-harm", /\b(harm myself|hurt myself|cut myself|self[- ]harm)\b/i],
  ["harm-to-others", /\b(kill (?:him|her|them|someone)|hurt (?:him|her|them|someone)|harm (?:him|her|them|someone))\b/i],
  ["immediate-danger", /\b(?:right now|tonight|immediately)\b.{0,50}\b(?:kill|die|harm|hurt|suicide)\b|\b(?:kill|die|harm|hurt|suicide)\b.{0,50}\b(?:right now|tonight|immediately)\b/i],
];

export function assessEmotionalSafety(checkIn: EmotionalCheckIn): EmotionalSafetyAssessment {
  const text = [checkIn.emotionalState.context ?? "", ...checkIn.emotionalState.emotions.map(({ name }) => name)].join(" ");
  const signals = signalPatterns.filter(([, pattern]) => pattern.test(text)).map(([signal]) => signal);
  return { level: signals.length > 0 ? "crisis" : "standard", signals: [...new Set(signals)] };
}

export function minimizeEmotionalCheckIn(checkIn: EmotionalCheckIn): RetainedEmotionalState {
  const { emotionalState, listeningMinutes, transitionSpeed } = checkIn;
  return {
    emotions: emotionalState.emotions.map(({ name, intensity }) => ({ name, intensity })),
    valence: emotionalState.valence,
    arousal: emotionalState.arousal,
    capturedAt: emotionalState.capturedAt,
    listeningMinutes,
    transitionSpeed,
  };
}

export function saveMinimizedEmotionalHistory(storage: Pick<Storage, "getItem" | "setItem">, checkIn: EmotionalCheckIn): number {
  let current: RetainedEmotionalState[] = [];
  try {
    const parsed = JSON.parse(storage.getItem(emotionalHistoryStorageKey) ?? "[]");
    if (Array.isArray(parsed)) current = parsed as RetainedEmotionalState[];
  } catch {
    current = [];
  }
  const next = [...current, minimizeEmotionalCheckIn(checkIn)].slice(-emotionalHistoryLimit);
  storage.setItem(emotionalHistoryStorageKey, JSON.stringify(next));
  return next.length;
}

export function deleteEmotionalHistory(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(emotionalHistoryStorageKey);
}
