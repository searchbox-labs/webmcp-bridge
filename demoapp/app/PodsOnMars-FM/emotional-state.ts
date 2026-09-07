export type EmotionalState = {
  emotions: Array<{
    name: string;
    intensity: number;
  }>;
  valence: number;
  arousal: number;
  senseOfControl?: number;
  socialConnection?: number;
  context?: string;
  capturedAt: string;
};

export type TransitionSpeed = "gradual" | "balanced" | "direct";

export type EmotionalCheckIn = {
  emotionalState: EmotionalState;
  listeningMinutes: 15 | 30 | 45 | 60;
  transitionSpeed: TransitionSpeed;
};

export const emotionRegions = {
  Heavy: ["Sadness", "Grief", "Heartbreak", "Disappointment", "Weariness", "Emptiness"],
  Tense: ["Anxiety", "Worry", "Stress", "Frustration", "Irritation", "Overwhelm"],
  Restless: ["Restlessness", "Impatience", "Agitation", "Anticipation", "Uncertainty", "Boredom"],
  Disconnected: ["Loneliness", "Isolation", "Numbness", "Detachment", "Alienation", "Homesickness"],
  Tender: ["Longing", "Nostalgia", "Vulnerability", "Affection", "Compassion", "Gratitude"],
  Calm: ["Calmness", "Relief", "Comfort", "Safety", "Contentment", "Serenity"],
  Energized: ["Excitement", "Motivation", "Determination", "Curiosity", "Playfulness", "Confidence"],
  Hopeful: ["Hope", "Optimism", "Courage", "Trust", "Belonging", "Inspiration"],
} as const;

export type EmotionRegion = keyof typeof emotionRegions;

export function createEmotionalState(input: Omit<EmotionalState, "capturedAt">, now = new Date()): EmotionalState {
  if (input.emotions.length === 0) throw new TypeError("Choose at least one emotion.");
  const emotions = input.emotions.map(({ name, intensity }) => {
    const normalizedName = name.trim();
    if (!normalizedName) throw new TypeError("Emotion names cannot be empty.");
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
      throw new RangeError("Emotion intensity must be between 0 and 1.");
    }
    return { name: normalizedName, intensity };
  });
  for (const [name, value, minimum] of [
    ["valence", input.valence, -1],
    ["arousal", input.arousal, 0],
    ["senseOfControl", input.senseOfControl, 0],
    ["socialConnection", input.socialConnection, 0],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < minimum || value > 1)) {
      throw new RangeError(`${name} is outside its supported range.`);
    }
  }
  const context = input.context?.trim();
  return {
    emotions,
    valence: input.valence,
    arousal: input.arousal,
    ...(input.senseOfControl === undefined ? {} : { senseOfControl: input.senseOfControl }),
    ...(input.socialConnection === undefined ? {} : { socialConnection: input.socialConnection }),
    ...(context ? { context } : {}),
    capturedAt: now.toISOString(),
  };
}
