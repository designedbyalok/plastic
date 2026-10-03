/** Editor-only image masks. They never enter the document model or exported markup. */
interface PendingImage {
  source: string;
  mask: HTMLDivElement | null;
  settled: boolean;
  decoding: boolean;
}
export class ImageLoading {
  private images = new Map<HTMLImageElement, PendingImage>();
  private frame = 0;
  private disposed = false;
  private resize: ResizeObserver;
  constructor(private owner: Document) {
    this.resize = new owner.defaultView!.ResizeObserver(() => this.position());
    owner.addEventListener('load', this.onLoad, true);
    owner.addEventListener('error', this.onError, true);
  }
  private source(img: HTMLImageElement) {
    return [img.getAttribute('src'), img.getAttribute('srcset'), img.getAttribute('sizes'), img.currentSrc].join('\n');
  }
  private onLoad = () => this.sync();
  private onError = (event: Event) => {
    const img = event.target as HTMLImageElement;
    const pending = this.images.get(img);
    if (pending) this.finish(img, pending);
  };
  sync() {
    if (this.disposed) return;
    const live = new Set(this.owner.body.querySelectorAll<HTMLImageElement>('img[data-pl-id]'));
    for (const [img, pending] of this.images) {
      if (!live.has(img)) { pending.mask?.remove(); this.resize.unobserve(img); this.images.delete(img); }
    }
    for (const img of live) {
      const source = this.source(img);
      let pending = this.images.get(img);
      if (pending?.source === source && pending.settled) continue;
      if (!pending || pending.source !== source) {
        pending?.mask?.remove();
        pending = { source, mask: null, settled: false, decoding: false };
        this.images.set(img, pending);
        this.resize.observe(img);
      }
      if (!(img.getAttribute('src') || img.getAttribute('srcset')) || (img.complete && !img.naturalWidth)) {
        this.finish(img, pending); continue;
      }
      if (!pending.mask) {
        const mask = this.owner.createElement('div');
        mask.className = 'chrome-skeleton';
        mask.setAttribute('data-plastic-image-loading', '');
        mask.setAttribute('aria-hidden', 'true');
        this.owner.body.append(mask);
        pending.mask = mask;
      }
      if (img.complete && !pending.decoding) {
        pending.decoding = true;
        const current = pending;
        // Cached images still need decoding. Old completions must not clear a replacement's mask.
        try {
          const decoded = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
          void decoded.then(() => this.finish(img, current), () => this.finish(img, current));
        } catch { this.finish(img, current); }
      }
    }
    this.position();
  }
  private finish(img: HTMLImageElement, pending: PendingImage) {
    if (this.disposed || this.images.get(img) !== pending) return;
    pending.mask?.remove(); pending.mask = null; pending.settled = true;
    this.resize.unobserve(img);
  }
  position() {
    if (this.disposed || this.frame) return;
    const win = this.owner.defaultView!;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      for (const [img, pending] of this.images) {
        if (!pending.mask || !img.isConnected) continue;
        const rect = img.getBoundingClientRect();
        const style = win.getComputedStyle(img);
        let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
        let opacity = Number(style.opacity || '1');
        // Masks live outside the authored tree; reproduce clipping and opacity without
        // inserting editor nodes into flex/grid containers or changing their layout.
        for (let parent = img.parentElement; parent && parent !== this.owner.body; parent = parent.parentElement) {
          const parentStyle = win.getComputedStyle(parent);
          opacity *= Number(parentStyle.opacity || '1');
          const bounds = parent.getBoundingClientRect();
          if (parentStyle.overflowX && parentStyle.overflowX !== 'visible') {
            left = Math.max(left, bounds.left + parent.clientLeft);
            right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
          }
          if (parentStyle.overflowY && parentStyle.overflowY !== 'visible') {
            top = Math.max(top, bounds.top + parent.clientTop);
            bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
          }
        }
        Object.assign(pending.mask.style, {
          left: `${rect.left + win.scrollX}px`, top: `${rect.top + win.scrollY}px`,
          width: `${rect.width}px`, height: `${rect.height}px`,
          borderRadius: style.borderRadius, visibility: style.visibility,
          display: style.display === 'none' || right <= left || bottom <= top ? 'none' : 'block',
          opacity: String(Number.isFinite(opacity) ? opacity : 1),
          clipPath: `inset(${Math.max(0, top - rect.top)}px ${Math.max(0, rect.right - right)}px ${Math.max(0, rect.bottom - bottom)}px ${Math.max(0, left - rect.left)}px)`,
        });
      }
    });
  }
  dispose() {
    this.disposed = true;
    const win = this.owner.defaultView!;
    win.cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.owner.removeEventListener('load', this.onLoad, true);
    this.owner.removeEventListener('error', this.onError, true);
    for (const pending of this.images.values()) pending.mask?.remove();
    this.images.clear();
  }
}
