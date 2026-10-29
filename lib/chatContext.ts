import type { ChatMessage } from "./types";

/**
 * Builds what the Assistant sees, within a token budget. Groq's free plan allows only ~8K
 * tokens per minute, which a long meeting's transcript alone exceeds, so long transcripts
 * are cut down to the lines most relevant to the question (plus their neighbours).
 */

/** Rough token count; Indonesian/English meeting text averages a bit over 3 characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.2);

const STOPWORDS = new Set(
  (
    "yang dan di ke dari ini itu untuk dengan pada adalah apa siapa kapan mana bagaimana kenapa mengapa ada tidak " +
    "akan sudah juga atau saja kita kami saya kamu dia mereka dalam oleh sebagai bisa harus lagi jadi ya tolong " +
    "the and for with that this what who when where how why are was were has have had will would can could about " +
    "from into does did meeting rapat tentang buat buatkan sebutkan jelaskan"
  ).split(" "),
);

function keywords(text: string) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter((w) => !STOPWORDS.has(w));
}

/** Picks transcript lines for the question: best keyword matches with 2 lines of context each. */
function excerpt(lines: string[], question: string, budget: number) {
  const terms = keywords(question);
  const scored = lines
    .map((line, i) => {
      const lower = line.toLowerCase();
      return { i, score: terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  // No keyword hits (e.g. "what were the main points?"): spread windows evenly across the meeting.
  const avgLine = lines.reduce((n, l) => n + estimateTokens(l), 0) / Math.max(1, lines.length);
  const windowsThatFit = Math.max(1, Math.floor(budget / (5 * avgLine)));
  const anchors = scored.length
    ? scored.map((s) => s.i)
    : Array.from({ length: windowsThatFit }, (_, k) => Math.floor(((k + 0.5) * lines.length) / windowsThatFit));

  const picked = new Set<number>();
  let used = 0;
  for (const anchor of anchors) {
    const window = [anchor - 2, anchor - 1, anchor, anchor + 1, anchor + 2].filter((i) => i >= 0 && i < lines.length && !picked.has(i));
    const cost = window.reduce((n, i) => n + estimateTokens(lines[i]), 0);
    if (used + cost > budget) {
      if (used > 0) continue;
      break;
    }
    window.forEach((i) => picked.add(i));
    used += cost;
  }

  const ordered = [...picked].sort((a, b) => a - b);
  return ordered.map((i, k) => (k > 0 && i !== ordered[k - 1] + 1 ? `…\n${lines[i]}` : lines[i])).join("\n");
}

export function buildChatContext(input: { title?: string; summary?: string; transcript: string; messages: ChatMessage[]; budgetTokens: number }) {
  const { title, transcript, messages, budgetTokens } = input;
  const summary = input.summary ? input.summary.slice(0, 4000) : "";

  // Keep the latest messages that fit; the newest question always goes in.
  const history: ChatMessage[] = [];
  let historyTokens = 0;
  for (const m of [...messages].reverse()) {
    const cost = estimateTokens(m.text);
    if (history.length > 0 && historyTokens + cost > budgetTokens * 0.25) break;
    history.unshift(m);
    historyTokens += cost;
  }

  const lines = transcript.split("\n").filter(Boolean);
  const fixedTokens = estimateTokens(summary) + historyTokens + 350; // 350 ≈ instructions
  const transcriptBudget = Math.max(500, budgetTokens - fixedTokens);
  const full = estimateTokens(transcript) <= transcriptBudget;
  const question = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.text).join(" ");
  const shown = full ? lines.join("\n") : excerpt(lines, question, transcriptBudget);

  const system = `You are the assistant for one recorded meeting${title ? ` titled "${title}"` : ""}.
Answer using only the meeting summary and transcript below.
- Reply in the same language the user writes in.
- When you refer to something said in the meeting, cite its timestamp like [12:34].
- If the answer is not in the material, say so plainly instead of guessing.
- Keep answers concise and use Markdown when it helps (lists, bold).
${
  full
    ? ""
    : "- The transcript below is an excerpt: only the parts most relevant to the question are included (\"…\" marks skipped parts). If something is not in it, say you could not find it in the transcript rather than claiming it was never said.\n"
}
${summary ? `<summary>\n${summary}\n</summary>\n\n` : ""}<transcript>
${shown}
</transcript>`;

  return { system, history, full };
}
