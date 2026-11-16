"use client";

import { useEffect, useState } from "react";
import { getSetting, putSetting } from "./db";

/**
 * Recordings kept in a folder on this computer, written and read by the browser (File System
 * Access API, Chrome and Edge on desktop). Used when the server's disk does not last — e.g.
 * Render's free plan — so the server only passes audio through to AssemblyAI.
 */

export type StorageMode = "server" | "device";

let modePromise: Promise<StorageMode> | null = null;

/** Asked once per page load; "server" if the question fails, the safe old behaviour. */
export function getStorageMode() {
  modePromise ??= fetch("/api/config", { cache: "no-store" })
    .then((res) => (res.ok ? res.json() : { storage: "server" }))
    .then((data: { storage?: string }) => (data.storage === "device" ? "device" : "server") as StorageMode)
    .catch(() => {
      modePromise = null;
      return "server" as StorageMode;
    });
  return modePromise;
}

export function useStorageMode() {
  const [mode, setMode] = useState<StorageMode | null>(null);
  useEffect(() => {
    void getStorageMode().then(setMode);
  }, []);
  return mode;
}

// ---- The folder ------------------------------------------------------------

/** The parts of the File System Access API that TypeScript's DOM types don't include yet. */
type PermissionMode = { mode: "read" | "readwrite" };
type Dir = FileSystemDirectoryHandle & {
  queryPermission(opts: PermissionMode): Promise<PermissionState>;
  requestPermission(opts: PermissionMode): Promise<PermissionState>;
};
type WithPicker = Window & {
  showDirectoryPicker?: (opts?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }) => Promise<Dir>;
};

const HANDLE_KEY = "recordingsFolder";
const READWRITE: PermissionMode = { mode: "readwrite" };
export const FOLDER_EVENT = "mi:folder";

/**
 * unsupported: this browser can't (Firefox, Safari, Brave by default) · none: no folder chosen yet ·
 * prompt: chosen, but the browser needs a click to allow it again · granted: ready.
 */
export type FolderAccess = "unsupported" | "none" | "prompt" | "granted";
export type FolderState = { access: FolderAccess; name?: string };

export const folderSupported = () => typeof window !== "undefined" && typeof (window as WithPicker).showDirectoryPicker === "function";

async function savedFolder() {
  return getSetting<Dir>(HANDLE_KEY);
}

export async function folderState(): Promise<FolderState> {
  if (!folderSupported()) return { access: "unsupported" };
  const dir = await savedFolder();
  if (!dir) return { access: "none" };
  const permission = await dir.queryPermission(READWRITE);
  return { access: permission === "granted" ? "granted" : permission === "prompt" ? "prompt" : "none", name: dir.name };
}

const announce = () => window.dispatchEvent(new Event(FOLDER_EVENT));

/** Opens the folder picker (needs a click). Returns false if the user cancelled. */
export async function chooseFolder() {
  const picker = (window as WithPicker).showDirectoryPicker;
  if (!picker) throw new Error("This browser can't save to a folder. Use Chrome or Edge on a computer.");
  let dir: Dir;
  try {
    dir = await picker({ id: "mi-recordings", mode: "readwrite", startIn: "documents" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return false;
    throw err;
  }
  await putSetting(HANDLE_KEY, dir);
  announce();
  return true;
}

/** After a browser restart the folder needs one click to allow it again (Chrome may offer "every visit"). */
export async function allowFolder() {
  const dir = await savedFolder();
  if (!dir) return chooseFolder();
  const ok = (await dir.requestPermission(READWRITE)) === "granted";
  announce();
  return ok;
}

export function useFolderState() {
  const [state, setState] = useState<FolderState | null>(null);
  useEffect(() => {
    const refresh = () => void folderState().then(setState, () => setState({ access: "none" }));
    refresh();
    window.addEventListener(FOLDER_EVENT, refresh);
    // Permission can also be granted or revoked from the browser's own site settings.
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(FOLDER_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return state;
}

async function readyFolder() {
  const dir = await savedFolder();
  if (!dir || (await dir.queryPermission(READWRITE)) !== "granted") return null;
  return dir;
}

/** True when the folder is chosen and allowed, so files can be written without a click. */
export async function folderReady() {
  return folderSupported() && (await readyFolder()) !== null;
}

/**
 * Writes a file into the folder. The browser writes to a temporary file and swaps it in on
 * close, so an interrupted write never leaves half a recording.
 */
export async function writeToFolder(name: string, blob: Blob) {
  const dir = await readyFolder();
  if (!dir) throw new Error("Choose your recordings folder first.");
  const file = await dir.getFileHandle(name, { create: true });
  const out = await file.createWritable();
  try {
    await out.write(blob);
    await out.close();
  } catch (err) {
    await out.abort().catch(() => {});
    throw err;
  }
  // Read it back: never delete the browser's copy unless the folder really has the whole file.
  const written = await file.getFile();
  if (written.size !== blob.size) throw new Error(`Saving ${name} to your folder was incomplete.`);
}

/** The file from the folder, or undefined when the folder isn't ready or doesn't have it. */
export async function readFromFolder(name: string) {
  const dir = await readyFolder();
  if (!dir) return undefined;
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotFoundError" || err.name === "TypeMismatchError")) return undefined;
    throw err;
  }
}
