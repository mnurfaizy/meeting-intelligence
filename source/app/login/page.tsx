"use client";

import { AudioLines, Lock } from "lucide-react";
import { useState } from "react";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      // Only same-site paths, never an absolute URL from the query string.
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Could not sign in.");
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-14">
      <span className="logo mb-7">
        <AudioLines size={24} strokeWidth={2.25} className="logo-icon" aria-hidden="true" />
        <span className="logo-text text-[22px]">meeting intelligence.</span>
      </span>
      <form onSubmit={submit} className="main-panel w-full max-w-[420px] p-9">
        <h1 className="mb-1.5 text-center text-[26px] font-bold tracking-[-0.6px]">Sign in</h1>
        <p className="mb-6 text-center text-ink-2">Enter the password to open your meetings.</p>
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-bold">Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input" />
        </label>
        {error && <p className="mt-3 text-[13px] font-semibold text-danger">{error}</p>}
        <button type="submit" disabled={busy || !password} className="btn btn-primary btn-block mt-5">
          {busy ? <Spinner /> : <Lock size={16} />}
          Sign in
        </button>
      </form>
    </div>
  );
}
