"use client";

import { MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { appendMessages } from "@/lib/store";
import { transcriptToText } from "@/lib/format";
import { streamChat } from "@/lib/pipeline";
import type { ChatMessage, Meeting } from "@/lib/types";
import { Markdown } from "./Markdown";
import { EmptyState, Spinner } from "./ui";

const SUGGESTIONS = [
  "Apa saja keputusan utama di meeting ini?",
  "Buat daftar action item beserta PIC-nya",
  "Apa yang masih belum terjawab?",
];

export function AssistantPanel({ meeting }: { meeting: Meeting }) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const ready = meeting.status === "ready" && meeting.transcript.length > 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [meeting.chat.length, streaming]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || streaming !== null) return;
    setInput("");
    setError(null);
    const asked: ChatMessage = { role: "user", text, at: Date.now() };
    const messages = [...meeting.chat, asked];
    setStreaming("");
    try {
      await appendMessages(meeting.id, [asked]);
      const reply = await streamChat(
        { title: meeting.title, transcript: transcriptToText(meeting.transcript), summary: meeting.summary, messages },
        setStreaming,
      );
      await appendMessages(meeting.id, [{ role: "model", text: reply, at: Date.now() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(null);
    }
  }

  if (!ready) {
    return (
      <EmptyState icon={<MessageSquare size={22} />} title="Assistant not ready yet">
        You can ask questions about this meeting once the transcript is ready.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {meeting.chat.length === 0 && streaming === null ? (
          <div className="empty mx-auto h-full max-w-md justify-center">
            <div className="empty-icon">
              <MessageSquare size={22} />
            </div>
            <h3>Ask anything about this meeting</h3>
            <p>Answers are based only on the transcript, with timestamps.</p>
            <div className="mt-2 flex w-full flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-[var(--radius-md)] border border-line bg-white px-3 py-2.5 text-left font-bold transition-colors hover:border-primary hover:bg-primary-soft"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {meeting.chat.map((m, i) => (
              <Bubble key={i} message={m} />
            ))}
            {streaming !== null && <Bubble message={{ role: "model", text: streaming, at: 0 }} pending={streaming === ""} />}
            {error && <p className="rounded-[var(--radius-md)] bg-danger-soft px-4 py-3 text-[13px] font-semibold text-danger">{error}</p>}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[var(--radius-xl)] border border-line bg-white py-2 pr-2 pl-5 shadow-[var(--shadow-raised)] focus-within:border-primary">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            placeholder="Ask about this meeting…"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 font-semibold outline-none placeholder:font-medium placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming !== null}
            title="Send"
            aria-label="Send"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-[var(--shadow-play)] transition-colors hover:bg-primary-hover"
          >
            {streaming !== null ? <Spinner /> : <Send size={16} />}
          </button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ message, pending }: { message: ChatMessage; pending?: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[var(--radius-lg)] rounded-br-[var(--radius-sm)] bg-primary-soft px-4 py-2.5 font-semibold whitespace-pre-wrap text-ink">
          {message.text}
        </p>
      </div>
    );
  }
  return pending ? (
    <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
      <Spinner size={14} /> Thinking…
    </div>
  ) : (
    <Markdown>{message.text}</Markdown>
  );
}
