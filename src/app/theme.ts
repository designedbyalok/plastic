/**
 * Light / dark theme for the app chrome (designs keep their own colors). The choice is a
 * per-device preference: "system" follows the OS. Applied as <html data-theme="…"> so the CSS
 * tokens in app.css switch.
 */
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'dark' | 'light';

const KEY = 'plastic:theme';
const listeners = new Set<() => void>();
const media = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-color-scheme: light)');

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' || value === 'system' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

let choice: ThemeChoice = read();

export function resolvedTheme(): 'dark' | 'light' {
  return choice === 'system' ? (media?.matches ? 'light' : 'dark') : choice;
}

export function applyTheme(): void {
  document.documentElement.dataset.theme = resolvedTheme();
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // a preference only
  }
  applyTheme();
  listeners.forEach((fn) => fn());
}

media?.addEventListener('change', () => {
  if (choice !== 'system') return;
  applyTheme();
  listeners.forEach((fn) => fn());
});

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => choice,
  );
}
