import { Suspense, lazy, useEffect } from 'react';
import { AppSkeleton } from './Skeleton.tsx';
import { AuthGate } from '../auth/AuthGate.tsx';
import { parseRoute, usePathname } from './router.ts';

// Each page is its own chunk: Home doesn't load the canvas and inspector, the editor doesn't load Home.
const loadEditor = () => import('./Editor.tsx');
const Editor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })));
const Home = lazy(() => import('../home/Home.tsx').then((m) => ({ default: m.Home })));

export function App() {
  const route = parseRoute(usePathname());
  // From Home, fetch the editor while idle so opening a file doesn't wait on it.
  useEffect(() => {
    if (route.name === 'file') return;
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1500));
    idle(() => void loadEditor());
  }, [route.name]);
  return (
    <AuthGate>
      <Suspense fallback={<AppSkeleton editor={route.name === 'file'} />}>{route.name === 'file' ? <Editor key={route.id} projectId={route.id} /> : <Home route={route} />}</Suspense>
    </AuthGate>
  );
}
