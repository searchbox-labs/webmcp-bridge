import type { PlaylistItem } from "./webmcp-capabilities";

export const feedbackOptions = ["This meets me where I am", "Too intense", "Too slow", "The lyrics are making it worse", "Move me forward", "Stay here longer", "More like this", "Skip this theme"] as const;
export type PlaylistFeedback = typeof feedbackOptions[number];

export function adaptRemainingPlaylist(items: PlaylistItem[], feedback: PlaylistFeedback): PlaylistItem[] {
  if (items.length < 2 || feedback === "This meets me where I am" || feedback === "Stay here longer") return items;
  const [current, ...remaining] = items;
  if (feedback === "Too intense") return [current!, ...remaining.toSorted((a, b) => (a.energy ?? 0.5) - (b.energy ?? 0.5))];
  if (feedback === "Too slow" || feedback === "Move me forward") return [current!, ...remaining.toSorted((a, b) => (b.energy ?? 0.5) - (a.energy ?? 0.5))];
  if (feedback === "The lyrics are making it worse") return [current!, ...remaining.filter((item) => !(item.distressingThemes?.length))];
  if (feedback === "More like this") return [current!, ...remaining.toSorted((a, b) => Number(b.artist === current!.artist) - Number(a.artist === current!.artist))];
  const theme = current!.themes?.[0];
  return theme ? [current!, ...remaining.filter((item) => !item.themes?.includes(theme))] : items;
}
