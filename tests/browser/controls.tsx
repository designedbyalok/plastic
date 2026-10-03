/** In-memory browser audit: user projects and clipboard are untouched. */
import { createRoot } from 'react-dom/client';
import { Canvas } from '../../src/canvas/Canvas.tsx';
import { ToolRail } from '../../src/panels/ToolRail.tsx';
import { LayersPanel } from '../../src/panels/LayersPanel.tsx';
import { Inspector } from '../../src/panels/inspector/Inspector.tsx';
import { CodePanel } from '../../src/panels/CodePanel.tsx';
import { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { tableShape } from '../../src/document/table.ts';
import { useShortcuts } from '../../src/editor/shortcuts.ts';
import { useEditor } from '../../src/editor/store.ts';
import { bundledFontsReady, loadInterFont } from '../../src/document/fonts.ts';
import { normalizeInterFonts } from '../../src/document/fontNames.ts';
import { domElement, clientRectOf } from '../../src/canvas/dom.ts';
import { textContent, getElement } from '../../src/document/tree.ts';
import { SHAPES } from '../../src/vector/shapes.ts';
import { INSERTABLES } from '../../src/elements/insertables.ts';
import { parseProject, serializeProject } from '../../src/serialization/index.ts';
import { docFrom, el } from '../helpers.ts';
import '../../src/app/app.css';
const fixture = docFrom({ tag: 'div', className: 'audit-frame', style: { position: 'relative', width: '600px', height: '500px', background: '#ffffff', 'font-family': 'Inter, sans-serif' }, children: [
  { tag: 'p', className: 'regular', style: { 'font-family': '"Inter Regular"', 'font-size': '28px', margin: '20px', color: '#111111' }, children: ['Inter Regular — 400'] },
  { tag: 'p', className: 'medium', style: { 'font-family': '"Inter Medium"', 'font-size': '28px', margin: '20px', color: '#111111' }, children: ['Inter Medium — 500'] },
] });
await bundledFontsReady;
const baseline = loadInterFont(normalizeInterFonts(fixture.doc));
const [regular, medium] = el(baseline, fixture.root).children;
const state = useEditor.getState;
function reset() { state().load(baseline); state().setViewport({ x: 30, y: 35, zoom: 1 }); state().setRulersVisible(false); state().select([fixture.root]); }
reset();
function Audit() {
  useShortcuts(); const code = useEditor(s => s.codeOpen);
  return <><div id="audit-bar" style={{ height: 150, padding: 12, overflow: 'auto', background: 'var(--ui-panel)' }}>
    <button onClick={() => void run()}>Run Tool and Control Audit</button><pre id="audit-result" role="status" style={{ fontSize: 11, whiteSpace: 'pre-wrap', margin: 8 }}>Ready</pre>
  </div><div className="app editor" style={{ height: 'calc(100vh - 150px)' }}><div className="workspace"><LayersPanel/><ToolRail/><Canvas/><Inspector/></div>{code && <CodePanel/>}</div></>;
}
createRoot(document.getElementById('root')!).render(<Audit/>);
const wait = (ms = 70) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, why: string): asserts value { if (!value) throw new Error(why); }
function button(label: string) { const el = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label || b.textContent?.trim().startsWith(label+' ')); assert(el, 'Missing button '+label); el.click(); }
function change(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); assert(input, 'Missing input '+label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); input.blur();
}
function pointer(target: EventTarget, type: string, x: number, y: number) { target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y })); }
async function draw(dx = 110, dy = 65) {
  const box = clientRectOf(domElement(fixture.root)!); const canvas = document.querySelector('.canvas')!;
  pointer(canvas, 'pointerdown', box.x + 220, box.y + 250);
  if (dx || dy) pointer(window, 'pointermove', box.x + 220 + dx, box.y + 250 + dy);
  pointer(window, 'pointerup', box.x + 220 + dx, box.y + 250 + dy); await wait();
}
async function choose(label: string, option: string) {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; assert(trigger, 'Missing '+label);
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', pointerId: 1 })); await wait();
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.trim() === option); assert(item, 'Missing option '+option); item.click(); await wait();
}
async function run() {
  const output = document.getElementById('audit-result')!; const log: string[] = [];
  async function check(name: string, fn: () => Promise<void>) { try { reset(); await wait(); await fn(); log.push('PASS '+name); } catch(e) { log.push('FAIL '+name+': '+String(e)); } output.textContent = log.join('\n'); }
  await check('Local Inter Regular and Medium', async () => {
    for (const [id, weight] of [[regular!, '400'], [medium!, '500']]) {
      const node = domElement(id)!; const fonts = node.ownerDocument.fonts; await fonts.load(`${weight} 28px Inter`, 'Plastic');
      const css = node.ownerDocument.defaultView!.getComputedStyle(node);
      assert(css.fontFamily === 'Inter' && css.fontWeight === weight, 'Wrong family or weight');
      assert([...fonts].some(face => face.family.replace(/["']/g,'') === 'Inter' && face.weight === '100 900' && face.status === 'loaded'), 'Variable face not loaded');
    }
  });
  await check('Select, Hand, Frame, Pen, Text, Heading, Image, Container Tool Buttons', async () => {
    for (const label of ['Hand (or hold Space)', 'Frame', 'Pen', 'Container', 'Text', 'Heading', 'Image']) { button(label); assert(state().tool.kind !== 'select', label+' inactive'); button('Select'); }
    button('Frame'); await draw(); assert(state().selection[0] !== fixture.root, 'Frame did not insert'); state().undo();
  });
  await check('All Six Shape Tools and Undo', async () => {
    for (const shape of SHAPES) {
      state().setTool({ kind: 'shape', shape: shape.kind }); await draw();
      const id = state().selection[0]!; assert(id !== fixture.root && !!domElement(id), shape.label+' not rendered');
      const node = getElement(state().doc, id)!; assert(shape.kind === 'rectangle' || shape.kind === 'ellipse' ? node.tag === 'div' : node.tag === 'svg', 'Wrong shape type');
      state().undo(); await wait(); assert(!state().doc.nodes[id], 'Shape undo failed');
    }
  });
  await check('Every Semantic Insert Tool and Inter Defaults', async () => {
    for (const item of INSERTABLES.filter(item => !item.editTextOnInsert)) {
      state().setTool({ kind: 'insert', itemId: item.id }); await draw(0,0);
      const id = state().selection[0]!; assert(id !== fixture.root && !!domElement(id), item.label+' not inserted');
      assert(domElement(id)!.ownerDocument.defaultView!.getComputedStyle(domElement(id)!).fontFamily.startsWith('Inter'), item.label+' wrong font');
      state().undo(); await wait();
    }
  });
  await check('Text Caret, Empty Cancellation, Fit Width, Inline Editing', async () => {
    state().setTool({ kind: 'insert', itemId: 'text' }); await draw(0,0); assert(document.querySelector('[aria-label="New Text"]'), 'No caret');
    state().setTool({ kind: 'select' }); assert(state().doc === baseline, 'Empty text inserted');
    state().setTool({ kind: 'insert', itemId: 'text' }); await draw(0,0);
    const draft = document.querySelector<HTMLElement>('[aria-label="New Text"]')!; draft.innerText = 'Typed Text'; state().setTool({ kind: 'select' }); await wait();
    const id = state().selection[0]!; assert(textContent(state().doc,id) === 'Typed Text', 'Text lost'); assert(state().doc.styles.rules[getElement(state().doc,id)!.classes[0]!]!.width === 'max-content', 'Text not Fit');
    state().setEditingText(id); await wait(); domElement(id)!.textContent = 'Edited Text'; domElement(id)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(); assert(textContent(state().doc,id) === 'Edited Text', 'Inline edit failed');
  });
  await check('Font Weight Menu, Typography, Fill', async () => {
    state().select([regular!]); await wait(); await choose('Font weight', 'Medium');
    assert(domElement(regular)!.ownerDocument.defaultView!.getComputedStyle(domElement(regular)!).fontWeight === '500', 'Medium selection failed');
    change('font-size', '32'); change('Fill Color', '245ABC'); await wait();
    const css = domElement(regular)!.ownerDocument.defaultView!.getComputedStyle(domElement(regular)!);
    assert(css.fontSize === '32px' && css.color === 'rgb(36, 90, 188)', 'Text control not applied');
  });
  await check('Size Fields, Rotation, Flips, Radius and Opacity', async () => {
    change('width', '420'); change('height', '360'); change('border-radius', '18'); change('Opacity percent', '65');
    button('Rotate 90 degrees'); await wait(); button('Flip Horizontal'); await wait(); button('Flip Vertical'); await wait();
    const css = domElement(fixture.root)!.ownerDocument.defaultView!.getComputedStyle(domElement(fixture.root)!);
    assert(css.width === '420px' && css.height === '360px' && css.borderRadius === '18px' && css.opacity === '0.65' && css.rotate === '90deg' && ['-1', '-1 -1'].includes(css.scale), 'Box control failed '+[css.width,css.height,css.borderRadius,css.opacity,css.rotate,css.scale].join(', '));
    state().undo(); state().redo(); await wait();
  });
  await check('Pen Path Creation and Editing Mode', async () => {
    state().setTool({kind:'pen'}); await draw(0,0); await wait();
    assert(state().vectorEdit?.drawing, 'Pen did not enter drawing mode');
    const box = clientRectOf(domElement(fixture.root)!); const canvas = document.querySelector('.canvas')!;
    pointer(canvas,'pointerdown',box.x+350,box.y+350); pointer(window,'pointerup',box.x+350,box.y+350); await wait();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles:true })); await wait();
    assert(state().selection.some(id => getElement(state().doc,id)?.tag === 'svg'), 'Pen SVG missing');
    state().setVectorEdit(null); state().setTool({kind:'select'});
  });
  await check('Hand Pan, Rulers and Keyboard Undo', async () => {
    state().setTool({kind:'hand'}); const before = state().viewport; await draw(60,40);
    assert(state().viewport.x !== before.x && state().viewport.y !== before.y, 'Pan failed');
    state().setRulersVisible(true); await wait(); assert(document.querySelector('.canvas-rulers'), 'Rulers missing');
    state().setTool({kind:'select'}); change('width','430'); await wait();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true})); await wait();
    assert(state().doc.styles.rules['audit-frame']!.width === '600px','Keyboard undo failed');
  });
  await check('Code Tabs and Live CSS Edits', async () => {
    state().setCodeOpen(true); await wait(); button('styles.css'); await wait();
    const cm = document.querySelector('.cm-editor'); assert(cm, 'Code editor missing'); const view = EditorView.findFromDOM(cm as HTMLElement)!;
    view.dispatch({changes:{from:view.state.doc.length, insert:'\n.audit-frame { border-radius: 23px; }'}, annotations: Transaction.userEvent.of('input.type')}); await wait(750);
    const css = domElement(fixture.root)!.ownerDocument.defaultView!.getComputedStyle(domElement(fixture.root)!);
    assert(css.borderRadius === '23px', 'CSS edit did not render: '+css.borderRadius+' '+document.querySelector('.code-error')?.textContent); state().setCodeOpen(false);
  });
  await check('Pages and Component Controls', async () => {
    button('Create Component'); await wait(); const components = state().doc.components; assert(components && Object.keys(components.definitions).length > 0, 'Component missing');
    button('Add Page'); await wait(); assert(state().doc.pages.length === 2, 'Page not added'); state().undo(); await wait(); assert(state().doc.pages.length === 1, 'Page undo failed');
  });
  await check('Width Sizing Modes, Margin and Min / Max Controls', async () => {
    state().select([regular!]); await wait();
    for (const mode of ['Fit', 'Fill', 'Relative', 'Fixed']) {
      document.querySelector('[aria-label="Width Sizing"]')!.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse',pointerId:1})); await wait(); const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(el => el.textContent?.trim() === mode); assert(option,'Missing sizing '+mode); option.click(); await wait();
      const width = state().doc.styles.rules.regular!.width; assert(width && (mode === 'Fit' ? width === 'max-content' : mode === 'Fill' ? width === '100%' : mode === 'Relative' ? width.endsWith('%') : width.endsWith('px')), 'Sizing mode failed '+mode);
    }
    change('margin','8px'); button('Add min / max size'); await wait(); change('min-width','80'); change('max-width','480'); await wait();
    const css = domElement(regular)!.ownerDocument.defaultView!.getComputedStyle(domElement(regular)!);
    assert(css.minWidth === '80px' && css.maxWidth === '480px', 'Constraints failed');
  });
  await check('Table Row and Column Controls', async () => {
    state().setTool({kind:'insert',itemId:'table'}); await draw(0,0); const id = state().selection[0]!; const before = tableShape(state().doc,id)!;
    button('Add rows'); button('Add columns'); await wait(); const after = tableShape(state().doc,id)!;
    assert(after.bodyRows.length === before.bodyRows.length+1 && after.columns === before.columns+1,'Table add failed');
    button('Remove rows'); button('Remove columns'); await wait(); const restored = tableShape(state().doc,id)!;
    assert(restored.bodyRows.length === before.bodyRows.length && restored.columns === before.columns,'Table remove failed');
  });
  await check('Flex, Alignment, Padding, Gap, Clip, Border, Shadow', async () => {
    button('Add Flex'); await wait(); button('Align Center Center'); change('gap', '18'); change('Padding X', '24'); change('Padding Y', '16');
    const clip = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(el => el.closest('label')?.textContent?.includes('Clip Content')); assert(clip, 'Clip missing'); clip.click();
    button('Add border'); button('Add shadow'); await wait();
    const css = domElement(fixture.root)!.ownerDocument.defaultView!.getComputedStyle(domElement(fixture.root)!);
    assert(css.display === 'flex' && css.justifyContent === 'center' && css.alignItems === 'center' && css.gap === '18px' && css.paddingLeft === '24px' && css.overflow === 'hidden' && css.borderTopWidth === '1px' && css.boxShadow !== 'none', 'Layout controls failed');
    button('Remove border'); button('Remove shadow'); await wait();
  });
  await check('Persistence Roundtrip and Font Weights', async () => {
    const parsed = parseProject(serializeProject(state().doc, { viewport: null, activePage: null, collapsed: [] })).doc;
    assert(parsed.styles.rules.medium!['font-weight'] === '500' && parsed.styles.rules.regular!['font-weight'] === '400', 'Weights lost on reload');
  });
  reset(); await wait(); state().select([medium!]); output.textContent = log.join('\n');
}
