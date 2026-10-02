/** The design parser uses DOMParser; outside a browser, jsdom provides it. */
import { JSDOM } from 'jsdom';

export function ensureDom(): void {
  if (typeof globalThis.DOMParser === 'undefined') {
    const { window } = new JSDOM('');
    (globalThis as { DOMParser?: typeof DOMParser }).DOMParser = window.DOMParser;
  }
}
