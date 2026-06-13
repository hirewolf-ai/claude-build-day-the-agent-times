import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
const DIR = "/Users/aykutgedik/Documents/make_shit_happen/development/claude-build-day-the-agent-times/.runs/read-2026-06-13T22-15-53-898";
const SEC = path.join(DIR, "sections");
mkdirSync(SEC, { recursive: true });
const PRINTING_PROMPT = readFileSync("/tmp/printprompt.txt","utf8");

const q = query({
  prompt: `Lay out today's edition. Read reader-profile.md (if present) and collected/surprise.md, then write the front page one story at a time into ${SEC}/ (01-lead.html first, then 02.html, ...). The workspace is the current directory.`,
  options: { model: "claude-opus-4-8", systemPrompt: PRINTING_PROMPT, cwd: DIR, allowedTools: ["Read","Write","Edit","Glob","Grep"], disallowedTools:["WebFetch","WebSearch","Bash"], permissionMode: "bypassPermissions", env: {...process.env, API_TIMEOUT_MS:"1800000"} },
});
const seen = new Set();
for await (const m of q) {
  try { for (const n of readdirSync(SEC).filter(x=>x.endsWith('.html')).sort()) { if(!seen.has(n)){ const h=readFileSync(path.join(SEC,n),'utf8'); if(h.includes('</article>')){seen.add(n); console.log('📄 SECTION:', n, '('+h.length+' chars)');}}}} catch{}
  if (m.type==='assistant') for (const b of m.message?.content??[]) if(b.type==='text'&&b.text.trim()) console.log('  [agent]', b.text.replace(/\s+/g,' ').slice(0,120));
  if (m.type==='result') console.log('=== DONE:', m.subtype, '— sections:', seen.size);
}
