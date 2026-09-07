import { emotionRegions, type EmotionalCheckIn, type EmotionRegion } from "./emotional-state";

export type ReachableStatePlan = {
  current: string;
  next: string;
  destination: string;
  transitionIntensity: "gentle" | "moderate" | "strong";
  transitionMinutes: number;
  totalMinutes: number;
};

const routes: Record<EmotionRegion, { next: string; destination: string }> = {
  Heavy: { next: "held and safe", destination: "quiet hope" },
  Tense: { next: "safe and accompanied", destination: "grounded confidence" },
  Restless: { next: "settled and directed", destination: "engaged focus" },
  Disconnected: { next: "seen and accompanied", destination: "warm belonging" },
  Tender: { next: "understood and comforted", destination: "open-hearted steadiness" },
  Calm: { next: "gently curious", destination: "renewed openness" },
  Energized: { next: "focused and purposeful", destination: "confident momentum" },
  Hopeful: { next: "supported optimism", destination: "grounded confidence" },
};

const emotionToRegion = new Map<string, EmotionRegion>(
  (Object.entries(emotionRegions) as Array<[EmotionRegion, readonly string[]]>).flatMap(([region, emotions]) =>
    emotions.map((emotion) => [emotion, region] as const),
  ),
);

export function planReachableState(checkIn: EmotionalCheckIn): ReachableStatePlan {
  const ordered = [...checkIn.emotionalState.emotions].sort((a, b) => b.intensity - a.intensity);
  if (ordered.length === 0) throw new TypeError("A transition plan needs at least one emotion.");
  const dominantRegion = emotionToRegion.get(ordered[0]!.name) ?? "Tender";
  const protectedState = dominantRegion === "Heavy" || dominantRegion === "Disconnected";
  const requestedIntensity = checkIn.transitionSpeed === "gradual"
    ? "gentle"
    : checkIn.transitionSpeed === "direct"
      ? "strong"
      : "moderate";
  const transitionIntensity = protectedState && requestedIntensity === "strong" ? "moderate" : requestedIntensity;
  const fraction = transitionIntensity === "gentle" ? 0.6 : transitionIntensity === "moderate" ? 0.45 : 0.3;
  const transitionMinutes = Math.max(5, Math.round(checkIn.listeningMinutes * fraction));

  return {
    current: ordered.slice(0, 3).map(({ name }) => name.toLowerCase()).join(" + "),
    ...routes[dominantRegion],
    transitionIntensity,
    transitionMinutes,
    totalMinutes: checkIn.listeningMinutes,
  };
}
