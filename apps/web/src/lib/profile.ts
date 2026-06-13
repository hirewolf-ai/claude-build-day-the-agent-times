/** Reader profile (name + location id). Source of truth lives in Postgres. */
export type Profile = {
  name: string;
  /** id of a LOCATION below */
  location: string;
};

export type Location = {
  id: string;
  label: string; // shown in the dropdown
  tz: string; // IANA timezone for their local time
};

/** Where our readers live. Add freely. */
export const LOCATIONS: Location[] = [
  { id: "sf", label: "San Francisco, USA", tz: "America/Los_Angeles" },
  { id: "nyc", label: "New York, USA", tz: "America/New_York" },
  { id: "istanbul", label: "Istanbul, Turkey", tz: "Europe/Istanbul" },
  { id: "paris", label: "Paris, France", tz: "Europe/Paris" },
  { id: "london", label: "London, UK", tz: "Europe/London" },
  { id: "berlin", label: "Berlin, Germany", tz: "Europe/Berlin" },
  { id: "dubai", label: "Dubai, UAE", tz: "Asia/Dubai" },
  { id: "tokyo", label: "Tokyo, Japan", tz: "Asia/Tokyo" },
  { id: "singapore", label: "Singapore", tz: "Asia/Singapore" },
  { id: "sydney", label: "Sydney, Australia", tz: "Australia/Sydney" },
];

export function locationById(id: string): Location | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

/** GitHub folder for the Chrome extension (renders its README). */
export const EXTENSION_REPO_URL =
  "https://github.com/hirewolf-ai/claude-build-day-the-agent-times/tree/main/apps/chrome";

/** Paths on x.com that are never a username. */
const X_RESERVED = new Set([
  "home", "explore", "notifications", "messages", "settings", "i", "search",
  "compose", "hashtag", "intent", "share", "login", "signup", "about",
]);

export type ParsedX = { handle: string; url: string };

/**
 * Parse anything a reader might paste for their X — "@aykut", "aykut",
 * "x.com/aykut", "https://twitter.com/aykut?s=20" — into a clean handle +
 * canonical URL. Returns null if it can't find a plausible handle.
 */
export function parseXProfile(input: string): ParsedX | null {
  let raw = (input || "").trim();
  if (!raw) return null;

  let candidate = raw;
  // If it looks like a URL (or host/path), pull the first path segment.
  if (/x\.com|twitter\.com|\//.test(raw)) {
    const cleaned = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    const m = cleaned.match(/(?:x\.com|twitter\.com)\/([^/?#]+)/i);
    if (m) candidate = m[1];
    else candidate = cleaned.split(/[/?#]/)[0]; // bare "aykut/..." → "aykut"
  }

  // Strip a leading @ and any stray query/hash.
  candidate = candidate.replace(/^@/, "").split(/[?#]/)[0].trim();

  // Valid X handles: 1–15 chars, letters/digits/underscore.
  if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate)) return null;
  if (X_RESERVED.has(candidate.toLowerCase())) return null;

  return { handle: candidate, url: `https://x.com/${candidate}` };
}

/** Greeting + dateline + clock for a reader, in THEIR location's local time. */
export function localTimeFor(tz: string, name: string) {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now),
  );
  const part =
    hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const greeting = `${part}, ${name}`;
  const dateline = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  return { greeting, dateline, clock };
}
