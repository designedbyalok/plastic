/** In-memory interaction fixture: no workspace API or user file is modified. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '../../src/canvas/Canvas.tsx';
import { LayersPanel } from '../../src/panels/LayersPanel.tsx';
import { useEditor } from '../../src/editor/store.ts';
import { domElement, clientRectOf } from '../../src/canvas/dom.ts';
import { getParentId } from '../../src/document/tree.ts';
import { instantiate } from '../../src/document/factory.ts';
import { insertRoot, setFrame, setName } from '../../src/document/ops.ts';
import { docFrom } from '../helpers.ts';
import '../../src/app/app.css';
const f = docFrom({ tag: 'div', className: 'outer', style: { position: 'relative', width: '480px', height: '360px', background: '#ffffff' } });
const made = instantiate(f.doc, { tag: 'div', className: 'stack', style: { display: 'flex', gap: '12px', padding: '20px', width: '480px', height: '260px', background: '#dae4ef' } });
let doc = setFrame(insertRoot(made.doc, 'index.html', 1, made.id), made.id, { x: 560, y: 0 });
doc = setName(setName(doc, f.root, 'Outer Frame'), made.id, 'Flex Frame');
const store = useEditor.getState;
store().load(doc); store().setViewport({ x: 30, y: 50, zoom: 1 });
store().setRulersVisible(false); store().select([f.root]);
function Fixture() {
  return <><div style={{ height: 70, padding: 12, background: 'var(--ui-panel)' }}>
    <button id="run" onClick={() => void run()}>Run Nesting Checks</button><span id="result" role="status" style={{ marginLeft: 16 }}>Ready</span>
  </div><div style={{ display: 'flex', height: 'calc(100vh - 70px)' }}><LayersPanel /><Canvas /></div></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
async function run() {
  const output = document.getElementById('result')!;
  try {
    output.textContent = 'Running…';
    for (let i = 0; i < 30 && !domElement(f.root); i++) await pause();
    store().select([f.root]); store().setTool({ kind: 'frame' }); await pause();
    const bounds = clientRectOf(domElement(f.root)!);
    const canvas = document.querySelector('.canvas')!;
    const pointer = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
    pointer(canvas, 'pointerdown', bounds.x + 40, bounds.y + 50);
    pointer(window, 'pointermove', bounds.x + 180, bounds.y + 140);
    pointer(window, 'pointerup', bounds.x + 180, bounds.y + 140);
    await pause();
    const child = store().selection[0]!;
    assert(getParentId(store().doc, child) === f.root, 'Draw did not nest');
    const inserted = domElement(child)!;
    assert(!!inserted, 'Nested frame not rendered');
    const rendered = clientRectOf(inserted);
    assert(Math.abs(rendered.x - bounds.x - 40) < 1 && Math.abs(rendered.width - 140) < 1, 'Nested geometry changed');
    const drag = (row: Element, type: string) => {
      const r = row.getBoundingClientRect();
      const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 80, clientY: r.y + r.height / 2, dataTransfer: transfer });
      row.dispatchEvent(event);
    };
    const transfer = new DataTransfer();
    drag(document.querySelector(`[data-layer-id="${child}"]`)!, 'dragstart');
    const target = document.querySelector(`[data-layer-id="${made.id}"]`)!;
    drag(target, 'dragover'); drag(target, 'drop'); await pause();
    assert(getParentId(store().doc, child) === made.id, 'Layer drop did not nest');
    const node = domElement(child)!;
    assert(node.ownerDocument.defaultView!.getComputedStyle(node).position === 'relative', 'Flex child remained absolute');
    const stack = clientRectOf(domElement(made.id)!); const nested = clientRectOf(node);
    assert(Math.abs(nested.x - stack.x - 20) < 1 && Math.abs(nested.y - stack.y - 20) < 1, 'Flex padding ignored');
    assert(Math.abs(nested.width - 140) < 1 && Math.abs(nested.height - 90) < 1, 'Flex stretched fixed frame dimensions');
    drag(document.querySelector(`[data-layer-id="${child}"]`)!, 'dragstart');
    const plain = document.querySelector(`[data-layer-id="${f.root}"]`)!;
    drag(plain, 'dragover'); drag(plain, 'drop'); await pause();
    const free = clientRectOf(domElement(child)!);
    assert(getParentId(store().doc, child) === f.root && Math.abs(free.x - nested.x) < 1 && Math.abs(free.y - nested.y) < 1, 'Plain frame reparent moved the frame');
    store().undo(); await pause();
    store().undo(); await pause();
    assert(getParentId(store().doc, child) === f.root, 'Move undo failed');
    store().undo(); await pause();
    assert(!store().doc.nodes[child], 'Create undo failed');
    store().redo(); store().redo(); await pause();
    assert(getParentId(store().doc, child) === made.id, 'Redo failed');
    output.textContent = 'PASS: Canvas Draw, Local Geometry, Layer Drop, Flex Flow, Free Position, Undo, Redo';
  } catch (e) { output.textContent = 'FAIL: ' + String(e); }
}
