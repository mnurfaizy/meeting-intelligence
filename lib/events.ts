"use client";

/** Fired on window after every write so hooks can re-read. */
export const CHANGE_EVENT = "mi:changed";

export function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
