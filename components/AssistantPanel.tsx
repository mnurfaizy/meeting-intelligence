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
      <EmptyState icon={<MessageSquare className="size-6" />} title="Assistant not ready yet">
        You can ask questions about this meeting once the transcript is ready.
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {meeting.chat.length === 0 && streaming === null ? (
          <div className="mx-auto flex h-full max-w-md flex-col justify-center text-center">
            <MessageSquare className="mx-auto mb-3 size-7 text-accent-hover" />
            <h3 className="font-medium text-gray-100">Ask anything about this meeting</h3>
            <p className="mt-1 text-sm text-gray-400">Answers are based only on the transcript, with timestamps.</p>
            <div className="mt-5 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm text-gray-300 hover:border-accent/60 hover:bg-white/5"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            {meeting.chat.map((m, i) => (
              <Bubble key={i} message={m} />
            ))}
            {streaming !== null && (
              <Bubble message={{ role: "model", text: streaming, at: 0 }} pending={streaming === ""} />
            )}
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
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
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-panel-2/60 p-2 focus-within:border-accent">
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
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming !== null}
            title="Send"
            className="grid size-9 place-items-center rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40"
          >
            {streaming !== null ? <Spinner /> : <Send className="size-4" />}
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
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-[#163b3c] px-4 py-2.5 text-[0.925rem] whitespace-pre-wrap text-gray-100">{message.text}</p>
      </div>
    );
  }
  return pending ? (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <Spinner className="size-3.5" /> Thinking…
    </div>
  ) : (
    <Markdown>{message.text}</Markdown>
  );
}
