import { useSyncExternalStore } from "react";
import { maxStack } from "./blocks";

export type Slot = { id: number; count: number } | null;
export type UIMode = "menu" | "play" | "paused" | "inventory" | "chest" | "craft" | "chat" | "dead";
export type ChatMsg = { name: string; text: string; t: number; sys?: boolean };

/** Mutable HUD-facing game state. Mutate, then call emit(). */
export const G = {
  name: "",
  room: "",
  hp: 20,
  hunger: 20,
  inv: Array<Slot>(36).fill(null),
  sel: 0,
  ui: "menu" as UIMode,
  chestKey: null as string | null,
  cursor: null as Slot,
  chat: [] as ChatMsg[],
  roster: [] as { id: string; name: string }[],
  underwater: false,
  hurtAt: 0,
  kills: 0,
  deaths: 0,
  status: "connecting" as "connecting" | "online" | "offline",
  clock: "",
  toast: "",
  toastAt: 0,
  killedBy: "",
};

let version = 0;
const subs = new Set<() => void>();
export function emit() {
  version++;
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export function useGame() {
  useSyncExternalStore(subscribe, () => version, () => version);
  return G;
}

export function toast(text: string) {
  G.toast = text;
  G.toastAt = performance.now();
  emit();
}
export function sysChat(text: string) {
  G.chat = [...G.chat.slice(-40), { name: "", text, t: performance.now(), sys: true }];
  emit();
}

/** Adds into inventory (stacking first). Returns leftover count. */
export function addItem(id: number, count: number, slots: Slot[] = G.inv): number {
  const max = maxStack(id);
  for (let i = 0; i < slots.length && count > 0; i++) {
    const s = slots[i];
    if (s && s.id === id && s.count < max) {
      const add = Math.min(max - s.count, count);
      s.count += add;
      count -= add;
    }
  }
  for (let i = 0; i < slots.length && count > 0; i++) {
    if (!slots[i]) {
      const add = Math.min(max, count);
      slots[i] = { id, count: add };
      count -= add;
    }
  }
  return count;
}
export function countItem(id: number) {
  return G.inv.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
}
export function removeItem(id: number, count: number) {
  for (let i = 0; i < G.inv.length && count > 0; i++) {
    const s = G.inv[i];
    if (s && s.id === id) {
      const take = Math.min(s.count, count);
      s.count -= take;
      count -= take;
      if (s.count <= 0) G.inv[i] = null;
    }
  }
}
export function held(): Slot {
  return G.inv[G.sel] ?? null;
}
