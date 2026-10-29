"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";

export function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-md text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Copy button that briefly shows a check mark. */
export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      title={copied ? "Copied" : "Copy"}
      disabled={disabled}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4 text-accent-hover" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-accent" : "bg-[#3a3a40]"}`}
    >
      <span className={`absolute top-1 left-1 size-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

/** Centered icon + title + text, used for empty, loading and error states. */
export function EmptyState({
  icon,
  title,
  children,
  tone = "default",
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
      <div
        className={
          tone === "error"
            ? "mb-4 text-red-400"
            : "mb-4 grid size-14 place-items-center rounded-2xl border border-line bg-[#17292a] text-accent-hover"
        }
      >
        {icon}
      </div>
      <h3 className="text-[1.05rem] font-medium text-gray-100">{title}</h3>
      {children && <div className="mt-2 max-w-sm text-sm leading-relaxed text-gray-400">{children}</div>}
    </div>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <LoaderCircle className={`${className} animate-spin`} />;
}
