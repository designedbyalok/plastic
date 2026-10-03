import type { RulerGuide } from '../document/types.ts';
import type { Viewport } from './coords.ts';

/** Major labels stay roughly 80–160 screen pixels apart across the supported zoom range. */
export function rulerTicks(length: number, pan: number, zoom: number, origin = 0) {
  const target = 80 / zoom;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const major = [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= target)!;
  const minor = major / 5;
  const start = Math.ceil(((-pan / zoom) - origin) / minor);
  const end = Math.floor((((length - pan) / zoom) - origin) / minor);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => {
    const index = start + i;
    const value = Number((index * minor).toPrecision(12));
    return { value, position: (value + origin) * zoom + pan, major: index % 5 === 0 };
  });
}

export function guideScreenPosition(guide: RulerGuide, viewport: Viewport, frameOrigin = 0): number {
  return (guide.value + frameOrigin) * viewport.zoom + viewport[guide.axis];
}
