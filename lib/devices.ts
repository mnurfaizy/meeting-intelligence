"use client";

import { useCallback, useEffect, useState } from "react";

/** Microphones the browser can use, kept up to date as headsets are plugged in or out. */
export function useMicrophones() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((d) => d.kind === "audioinput"));
    } catch {
      setMics([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [refresh]);

  /** Browsers hide device names until mic access was granted once; ask so the list is readable. */
  const unlockNames = useCallback(async () => {
    if (mics.some((m) => m.label)) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch {
      // Without permission the list still works, just with generic names.
    }
  }, [mics, refresh]);

  return { mics, unlockNames };
}

const STORAGE_KEY = "mi.microphone";

/** The chosen microphone, remembered in this browser ("" = system default). */
export function useSavedMicrophone() {
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    try {
      setDeviceId(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      // Storage can be unavailable (private window); the default mic is used then.
    }
  }, []);
  const choose = useCallback((id: string) => {
    setDeviceId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Not remembered, but still used for this session.
    }
  }, []);
  return [deviceId, choose] as const;
}
