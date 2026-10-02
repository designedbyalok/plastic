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
  set: (patch) => set(patch),
  clear: () => set({ marquee: null, draft: null, ghost: null, dropLine: null, dropTarget: null }),
}));
