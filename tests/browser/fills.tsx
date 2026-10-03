/** Disposable browser fixture for paint controls; never opens or modifies a user's file. */
import { createRoot } from 'react-dom/client';
import { FillSection } from '../../src/panels/inspector/FillSection.tsx';
import { useEditor } from '../../src/editor/store.ts';
import { docFrom } from '../helpers.ts';
import { serializeNode } from '../../src/serialization/html.ts';
import { serializeStyleSheet } from '../../src/document/css.ts';
import '../../src/app/app.css';

const examples = {
  Solid: { 'background': '#ffffff', width: '260px', height: '180px', 'border-radius': '12px' },
  Gradient: { 'background-image': 'linear-gradient(135deg, #ffffff 0%, #bebebe 100%)', width: '260px', height: '180px' },
  Image: { 'background-image': `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#687986"/></svg>')}")`, 'background-size': 'cover', width: '260px', height: '180px' },
  Text: { color: '#ffffff', 'font-family': 'Inter, sans-serif', 'font-size': '32px' },
};
let id = '';
let textual = false;
function load(name: keyof typeof examples) {
  textual = name === 'Text';
  const fixture = docFrom({ tag: textual ? 'p' : 'div', className: 'fill-example', style: examples[name], children: textual ? ['Plastic'] : [] });
  id = fixture.root;
  useEditor.getState().load(fixture.doc);
  useEditor.getState().select([id]);
}
function Fixture() {
  const doc = useEditor(s => s.doc);
  return <div style={{ display: 'flex', height: '100vh', background: 'var(--ui-bg)' }}>
    <main style={{ flex: 1, minWidth: 0, padding: 32 }}>
      <h1 style={{ fontSize: 16, marginBottom: 20 }}>Fill Controls</h1>
      <div style={{ display: 'flex', gap: 8 }}>{Object.keys(examples).map(name => <button className="insp-button" style={{ width: 90 }} key={name} onClick={() => load(name as keyof typeof examples)}>{name} Example</button>)}<button className="insp-button" style={{ width: 60 }} onClick={() => useEditor.getState().undo()}>Undo</button></div>
      <div style={{ marginTop: 50 }} dangerouslySetInnerHTML={{ __html: `<style>${serializeStyleSheet(doc.styles)}</style>${serializeNode(doc, id, 0)}` }} />
      <pre role="status" style={{ marginTop: 30, fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(doc.styles.rules, null, 2)}</pre>
    </main>
    <aside className="panel inspector" style={{ width: 280, flexShrink: 0 }}><FillSection key={id} ids={[id]} textual={textual} /></aside>
  </div>;
}
load('Solid');
createRoot(document.getElementById('root')!).render(<Fixture />);
