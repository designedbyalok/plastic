/**
 * "Update available" after a deploy. The running build's id is compiled in; /version.json holds
 * the deployed one. It's a static file (no Worker request, no cost), checked when the tab comes
 * back into view (at most every 5 minutes) and every 30 minutes while it's visible.
 */
import { ArrowDownToLine } from 'lucide-react';
import { useEffect, useState } from 'react';

const CHECK_EVERY = 30 * 60_000;
const MIN_GAP = 5 * 60_000;
const DISMISSED = 'plastic:update-dismissed';

async function deployedBuild(): Promise<string | null> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const { build } = (await response.json()) as { build?: unknown };
    return typeof build === 'string' ? build : null;
  } catch {
    return null;
  }
}

function dismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISSED);
  } catch {
    return null;
  }
}

export function UpdatePrompt() {
  const [available, setAvailable] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (__PLASTIC_BUILD__ === 'dev') return;
    let last = 0;
    const check = async () => {
      if (document.hidden || Date.now() - last < MIN_GAP) return;
      last = Date.now();
      const build = await deployedBuild();
      if (build && build !== __PLASTIC_BUILD__ && build !== dismissed()) setAvailable(build);
    };
    const timer = setInterval(() => void check(), CHECK_EVERY);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!available) return null;

  const update = async () => {
    setReloading(true);
    setError(null);
    // Save the open file first, so updating never loses an edit.
    try {
      const { flushForReload } = await import('../editor/persistence.ts');
      await flushForReload();
    } catch (error) {
      console.error(error);
      setError('Couldn’t save your changes. Please check your connection and try again.');
      setReloading(false);
      return;
    }
    location.reload();
  };

  const later = () => {
    try {
      sessionStorage.setItem(DISMISSED, available);
    } catch {
      // only affects this tab
    }
    setAvailable(null);
  };

  return (
    <div className="update-prompt" role="status" aria-live="polite" aria-labelledby="update-title">
      <span className="update-icon" aria-hidden="true">
        <ArrowDownToLine size={18} strokeWidth={1.5} />
      </span>
      <p id="update-title" className="update-title">
        Update available
      </p>
      <p className="update-body">A new version of Plastic is ready. Reload to apply the update.</p>
      {error && <p className="update-body" role="alert">{error}</p>}
      <div className="update-actions">
        <button type="button" className="update-primary" onClick={() => void update()} disabled={reloading}>
          {reloading ? 'Saving and reloading…' : 'Refresh to update'}
        </button>
        <button type="button" className="update-secondary" onClick={later} disabled={reloading}>
          Not now
        </button>
      </div>
    </div>
  );
}
