/** Transient visuals drawn by the overlay while a gesture is in progress (screen space). */
import { create } from 'zustand';
import type { Rect } from './coords.ts';

export interface Line {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

interface GestureVisuals {
  readonly marquee: Rect | null;
  readonly draft: Rect | null;
  readonly ghost: Rect | null;
  readonly dropLine: Line | null;
  readonly dropTarget: Rect | null;
  /** Pointer position (screen space) for the pen's preview segment; null when off the canvas. */
  readonly pen: { readonly x: number; readonly y: number; readonly shift: boolean } | null;
  /** Snap guide lines (screen space) while a gesture snaps to something. */
  readonly guides: readonly Line[];
  /** A short message at the bottom of the canvas (e.g. why an operation did nothing). */
  readonly notice: string | null;
  set(patch: Partial<Omit<GestureVisuals, 'set' | 'clear'>>): void;
  clear(): void;
}

export const useGesture = create<GestureVisuals>()((set) => ({
  marquee: null,
  draft: null,
  ghost: null,
  dropLine: null,
  dropTarget: null,
  pen: null,
  notice: null,
  guides: [],
  set: (patch) => set(patch),
  clear: () => set({ marquee: null, draft: null, ghost: null, dropLine: null, dropTarget: null, guides: [] }),
}));

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a brief message on the canvas. */
export function notify(message: string): void {
  clearTimeout(noticeTimer);
  useGesture.getState().set({ notice: message });
  noticeTimer = setTimeout(() => useGesture.getState().set({ notice: null }), 3500);
}
