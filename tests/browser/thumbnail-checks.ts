import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Thumbnail } from '../../src/home/Thumbnail.tsx';
import { connectWorkspace, browserFiles } from '../../src/serialization/storage.ts';
import { openProject, saveNow } from '../../src/editor/persistence.ts';
import { useEditor } from '../../src/editor/store.ts';
import { parseStyleSheet } from '../../src/document/css.ts';
import { useAsThumbnail, captureThumbnail, thumbnailSource } from '../../src/editor/thumbnail.ts';
import { parseProject, serializeProject } from '../../src/serialization/index.ts';
const result = document.getElementById('result')!;
async function run() {
  const files = {
    'index.html': '<main data-pl-id="first" style="width:300px;height:200px">First page</main>',
    'second.html': '<main data-pl-id="board" class="board"><section data-pl-id="chosen" class="chosen"><h1>Chosen Frame</h1><img src="/favicon-32.png"></section><div>Excluded sibling</div></main>',
    'styles.css': '.board{width:800px;height:600px;background:red}.chosen{width:400px;height:240px;background:linear-gradient(45deg,#2344aa,#ffcc88);color:white;font:24px sans-serif}h1{margin:0;padding:24px}',
    'tokens.css': '',
    'project.json': JSON.stringify({pages:[{file:'index.html',name:'First'},{file:'second.html',name:'Second'}]})
  };
  const { doc, meta } = parseProject(files);
  const thumbnail = await captureThumbnail(doc, 'chosen', null);
  if (thumbnail.width !== 400 || thumbnail.height !== 240 || thumbnail.page !== 'second.html') throw new Error(`Wrong dimensions ${JSON.stringify({...thumbnail,image:'omitted'})}`);
  const saved = parseProject(serializeProject({ ...doc, thumbnail }, meta));
  if (saved.doc.thumbnail?.frame !== 'chosen') throw new Error('Selection did not persist');
  if (await thumbnailSource({ ...doc, title: 'Renamed' }, 'chosen') !== thumbnail.source) throw new Error('Title should not recapture');
  if (await thumbnailSource({ ...doc, styles: { rules: {}, preserved: '.chosen{color:red}', preservedAfter: '' } }, 'chosen') === thumbnail.source) throw new Error('CSS edit should refresh');
  const img = new Image(); img.src = thumbnail.image; await img.decode();
  if (img.naturalWidth !== 400) throw new Error('Wrong raster width');
  const canvas = document.createElement('canvas'); canvas.width=400;canvas.height=240;
  const ctx = canvas.getContext('2d')!;ctx.drawImage(img,0,0);
  const pixel=ctx.getImageData(390,230,1,1).data;
  if (pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255) throw new Error('Blank capture');
  const workspace = await connectWorkspace();
  const id = await workspace.create('Thumbnail browser check', files);
  const opened = await openProject(id);
  if (!opened.found) throw new Error('Could not open test project');
  try {
    await useAsThumbnail('chosen');
    const initial = useEditor.getState().doc.thumbnail;
    if (!initial) throw new Error('Use as Thumbnail did not save');
    const historyBefore = useEditor.getState().history.past.length;
    useEditor.getState().apply('Change frame color', d => ({ ...d, styles: parseStyleSheet(files['styles.css'] + '.chosen{background:#00aa55}') }));
    await saveNow();
    const edited = useEditor.getState().doc.thumbnail;
    if (edited?.source === initial.source) throw new Error('Autosave did not refresh thumbnail');
    if (useEditor.getState().history.past.length !== historyBefore + 1) throw new Error('Thumbnail refresh added an undo step');
    const persisted = await workspace.open(id).load();
    const reopened = parseProject(persisted!);
    if (reopened.doc.thumbnail?.image !== edited?.image) throw new Error('New snapshot did not persist');
    const cover = document.createElement('div');
    cover.style.cssText = 'width:400px;height:240px;margin:16px 0;background:#eee';
    document.body.append(cover);
    const dashboard = createRoot(cover);
    flushSync(() => dashboard.render(createElement(Thumbnail, { doc: reopened.doc, css: files['styles.css'] })));
    const coverImage = cover.querySelector('img');
    if (coverImage?.getAttribute('src') !== edited?.image || cover.querySelector('iframe')) throw new Error('Dashboard did not use exact saved thumbnail');
    useEditor.getState().undo();
    await saveNow();
    if (useEditor.getState().doc.thumbnail?.source !== initial.source) throw new Error('One undo did not restore frame appearance');
  } finally { opened.stop(); if (workspace.kind === 'browser') browserFiles.remove(id); }
  document.body.append(img);
  result.textContent = `PASS: inactive page, nested frame, image asset, 400 × 240 PNG, round trip, automatic refresh, one-step undo, dashboard uses exact PNG, nonblank pixels (${Array.from(pixel)}).`;
}
run().catch(error => { result.textContent = `FAIL: ${error.stack || error}`; });
