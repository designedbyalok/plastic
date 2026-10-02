import { AuthGate } from '../auth/AuthGate.tsx';
import { Home } from '../home/Home.tsx';
import { Editor } from './Editor.tsx';
import { parseRoute, usePathname } from './router.ts';

export function App() {
  const route = parseRoute(usePathname());
  return <AuthGate>{route.name === 'file' ? <Editor key={route.id} projectId={route.id} /> : <Home />}</AuthGate>;
}
