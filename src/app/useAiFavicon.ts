import { useEffect } from 'react';
import { useAiPresence } from '../editor/aiPresence.ts';
/** Draw the actual loading-dev Blocks cell animation into a favicon (CSS SVG favicons do not reliably animate). */
export function useAiFavicon() {
  const active = useAiPresence(s => s.activity.length > 0);
  useEffect(() => {
    if (!active) return;
    const original = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
    original.forEach(link => { link.rel = 'plastic-idle-icon'; });
    const link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/png'; link.setAttribute('sizes', '32x32'); document.head.append(link);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d');
    if (!context) { link.remove(); original.forEach(icon => { icon.rel = 'icon'; }); return; }
    const draw = () => {
      if (!context) return;
      const cells = document.querySelectorAll<HTMLElement>('.ai-favicon-spinner .ld-blocks-cell');
      context.clearRect(0, 0, 32, 32); context.fillStyle = '#2a2a2a'; context.beginPath(); context.roundRect(0, 0, 32, 32, 6); context.fill();
      context.fillStyle = '#ffffff';
      cells.forEach((cell, index) => {
        const transform = getComputedStyle(cell).transform;
        const scale = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
        const size = 6.4 * Math.abs(scale); const x = 3.2 + index % 3 * 9.6 + (6.4 - size) / 2; const y = 3.2 + Math.floor(index / 3) * 9.6 + (6.4 - size) / 2;
        context.beginPath(); context.roundRect(x, y, size, size, Math.min(1.6, size / 2)); context.fill();
      });
      link.href = canvas.toDataURL('image/png');
    };
    draw(); const timer = setInterval(draw, 120);
    return () => { clearInterval(timer); link.remove(); original.forEach(icon => { icon.rel = 'icon'; }); };
  }, [active]);
}
