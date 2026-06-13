/**
 * Mock "edition build" — the scripted choreography that drives the builder view
 * until the real backend (the-agent-times-agents + chrome) is wired.
 *
 * The whole experience is a timeline of `beats`. Each beat either:
 *   - pushes an agent-activity line into the left feed, and/or
 *   - advances the paper-build stage on the right.
 *
 * Timings are in ms (delay BEFORE the beat fires, relative to the previous one).
 * Keep it lively but not frantic — this plays under the reader's coffee.
 */

export type Agent =
  | "researcher" // the Research Desk — reads the live web via the chrome extension
  | "compiler" // assembles the warehouse brief
  | "design" // the Design Desk — sets layout + writes headlines
  | "columnist"; // writes a section in voice (opinions)

export type FeedLine = {
  agent: Agent;
  /** Top-level activity line. */
  text: string;
  /** Optional nested sub-line (indented "└ reading …"). */
  sub?: string;
  /** Mark a previously-running line as done (checks it off). */
  done?: boolean;
};

/** Paper-build stages on the right; each beat may bump us to a new stage. */
export type PaperStage =
  | "blank"
  | "masthead"
  | "lead"
  | "columns" // columns shimmering in
  | "done";

export type Beat = {
  delay: number;
  line?: FeedLine;
  stage?: PaperStage;
};

const COLUMNISTS = [
  { byline: "Ada Vance", desk: "AI & Agents" },
  { byline: "Marcus Delk", desk: "Markets" },
  { byline: "Юлия / Julia Reyes", desk: "Culture" },
  { byline: "The Editor", desk: "Op-Ed" },
];

/**
 * Build the timeline for a given reader prompt. The prompt only flavors a couple
 * of the opening lines; the shape of the build is the same every time (for now).
 */
export function buildEditionScript(prompt: string): Beat[] {
  const topic = prompt.trim();
  const focus = topic
    ? `your request — "${truncate(topic, 60)}"`
    : "a general edition";

  const sites = [
    "nytimes.com",
    "techmeme.com",
    "reuters.com",
    "hn.algolia.com",
    "ft.com",
    "theverge.com",
    "arxiv.org",
    "bloomberg.com",
  ];

  const beats: Beat[] = [
    { delay: 250, line: { agent: "researcher", text: `Brewing today's edition around ${focus}.` } },
    { delay: 650, line: { agent: "researcher", text: "Dispatching the Research Desk onto the live web…" }, stage: "masthead" },
  ];

  // Researchers read "hundreds" of pages — stream a few representative ones with a
  // running counter that climbs faster than the lines (so it feels like a lot).
  let pages = 0;
  for (let i = 0; i < sites.length; i++) {
    pages += 11 + ((i * 17) % 23);
    beats.push({
      delay: 480,
      line: {
        agent: "researcher",
        text: `Reading the live web · ${pages} pages so far`,
        sub: `└ ${sites[i]} … page ${3 + ((i * 7) % 40)}`,
      },
    });
  }

  beats.push(
    { delay: 600, line: { agent: "researcher", text: `Research Desk read ${pages + 38} pages. Filing it all home.`, done: true } },
    { delay: 700, line: { agent: "compiler", text: "Compiling the brief — deduping, ranking, fact-cross-checking." } },
    { delay: 850, line: { agent: "compiler", text: "Brief filed to the newsroom warehouse.", done: true }, stage: "lead" },
    { delay: 700, line: { agent: "design", text: "Design Desk laying out today's front page." } },
    { delay: 800, line: { agent: "design", text: "Headline writers sharpening the splash…" } },
    { delay: 850, line: { agent: "design", text: "Front page locked. Columns assigned.", done: true }, stage: "columns" },
  );

  // Each columnist gets dispatched then files, in voice.
  for (const c of COLUMNISTS) {
    beats.push({
      delay: 620,
      line: { agent: "columnist", text: `✎ ${c.byline} is writing the ${c.desk} column…` },
    });
    beats.push({
      delay: 680,
      line: { agent: "columnist", text: `${c.byline} filed “${c.desk}” — and has opinions.`, done: true },
    });
  }

  beats.push({ delay: 700, line: { agent: "design", text: "Edition is going to press. Enjoy your coffee. ☕", done: true }, stage: "done" });

  return beats;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const AGENT_META: Record<Agent, { name: string; color: string }> = {
  researcher: { name: "Research Desk", color: "#d9805a" },
  compiler: { name: "Compiler", color: "#c9a14a" },
  design: { name: "Design Desk", color: "#7a9e7e" },
  columnist: { name: "Columnist", color: "#8a8fd0" },
};
