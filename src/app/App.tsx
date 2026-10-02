import { Home } from '../home/Home';
import { Editor } from './Editor';
import { parseRoute, usePathname } from './router';

export function App() {
  const route = parseRoute(usePathname());
  return route.name === 'file' ? <Editor key={route.id} projectId={route.id} /> : <Home />;
}
