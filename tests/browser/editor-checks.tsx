/** Dev-only browser regression and performance runner. Uses disposable workspace projects. */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { EditorView } from "@codemirror/view";
import { Editor } from "../../src/app/Editor.tsx";
import "../../src/app/app.css";
import { applyTheme } from "../../src/app/theme.ts";
import { useEditor } from "../../src/editor/store.ts";
import { domElement, screenRectOf } from "../../src/canvas/dom.ts";
import { setText } from "../../src/document/ops.ts";
import { getElement } from "../../src/document/tree.ts";
import { saveNow } from "../../src/editor/persistence.ts";

applyTheme();
const root = createRoot(document.getElementById("root")!);
const checks = document.getElementById("checks")!;
checks.innerHTML =
  '<button id="run">Run Interaction Checks</button><button id="profile">Load Large Design and Profile</button><button id="repeat">Repeat Profile</button><pre id="results" role="status">Ready. Runs create disposable browser-check projects in the configured workspace.</pre>';
const style = document.createElement("style");
style.textContent =
  "#checks { height:220px; padding:8px 12px; box-sizing:border-box; background:var(--ui-panel); overflow:auto; } #checks button { margin-right:12px; } #results { font:11px monospace; white-space:pre-wrap; margin:8px 0; } #root { height:calc(100vh - 220px); } #root .app { height:100%; }";
document.head.append(style);
const output = document.getElementById("results")!;
const report: string[] = [];
let file = "";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const frames = async () => {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
};
async function until(check: () => boolean, label: string, timeout = 12000) {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > timeout)
      throw new Error(`Timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}
function log(text: string) {
  report.push(text);
  output.textContent = report.join("\n");
}
const state = () => useEditor.getState();
function clientBox(id: string) {
  const r = screenRectOf(id)!;
  const canvas = document.querySelector(".canvas")!.getBoundingClientRect();
  return { ...r, x: r.x + canvas.left, y: r.y + canvas.top };
}
const frameHtml = (id: string, children: string) =>
  `<main data-pl-id="${id}" class="board">${children}</main>`;
const basic = {
  "index.html": frameHtml(
    "board",
    '<p data-pl-id="text" class="label">Hello</p><div data-pl-id="box" class="box"></div><iframe data-pl-id="embed" srcdoc="&lt;script&gt;parent.document.body.dataset.embedEscaped=1&lt;/script&gt;"></iframe>',
  ),
  "styles.css":
    ".board{position:relative;width:600px;height:400px;background:white;color:#111}.label{position:absolute;left:40px;top:30px;margin:0;font:20px sans-serif}.box{position:absolute;left:40px;top:100px;width:100px;height:80px;background:#e55}.board iframe{display:none}@media(max-width:400px){.box{background:rgb(0,128,0)}}",
};
async function open(files: Record<string, string>, title: string) {
  files = {
    ...files,
    "index.html": `<title>${title}</title>` + files["index.html"],
  };
  files["project.json"] ??= JSON.stringify({
    format: "plastic",
    version: 2,
    pages: [{ file: "index.html", name: "Page 1" }],
    files: { styles: "styles.css", tokens: "tokens.css" },
    canvas: {
      viewport: { x: 80, y: 60, zoom: 1 },
      activePage: "index.html",
      frames: { board: { x: 0, y: 0 } },
    },
    layers: { names: {}, collapsed: [] },
  });
  const response = await fetch("/__plastic/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, files }),
  });
  assert(response.ok, "Cannot create disposable local fixture");
  file = (await response.json()).id;
  flushSync(() => root.render(<Editor key={file} projectId={file} />));
  await until(
    () => !!domElement("board") && !!document.querySelector(".canvas"),
    "fixture mounted",
  );
  state().setViewport({ x: 80, y: 60, zoom: 1 });
  state().setRulersVisible(false);
  await frames();
}
function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  extra: PointerEventInit = {},
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pointerId: 1,
      ...extra,
    }),
  );
}
async function gesture(target: Element, x: number, y: number, dx = 0, dy = 0) {
  pointer(target, "pointerdown", x, y);
  if (dx || dy) pointer(window, "pointermove", x + dx, y + dy);
  pointer(window, "pointerup", x + dx, y + dy);
  await frames();
}
async function interactions() {
  await open(basic, "Browser Check — Interactions");
  const canvas = document.querySelector(".canvas")!;
  let rect = clientBox("box");
  await gesture(canvas, rect.x + 20, rect.y + 20);
  assert(state().selection.includes("box"), "Canvas click did not select box");
  log("PASS Select");
  const before = domElement("box")!.getBoundingClientRect();
  await gesture(canvas, rect.x + 20, rect.y + 20, 35, 25);
  assert(
    Math.abs(
      domElement("box")!.getBoundingClientRect().left - before.left - 35,
    ) < 1,
    "Drag did not move box",
  );
  log("PASS Drag");
  rect = clientBox("box");
  await gesture(
    document.querySelector(".ov-handle-se")!,
    rect.x + rect.width,
    rect.y + rect.height,
    30,
    20,
  );
  assert(
    Math.abs(domElement("box")!.getBoundingClientRect().width - 130) < 1,
    "Resize did not update width",
  );
  log("PASS Resize");
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }),
  );
  await frames();
  assert(
    Math.abs(domElement("box")!.getBoundingClientRect().width - 100) < 1,
    "Shortcut undo failed",
  );
  log("PASS Undo");
  rect = clientBox("text");
  canvas.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      clientX: rect.x + 10,
      clientY: rect.y + 10,
    }),
  );
  await frames();
  const text = domElement("text")!;
  assert(text.isContentEditable, "Double-click did not enter inline editing");
  text.textContent = "Typed in Browser";
  text.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: "Typed in Browser",
    }),
  );
  text.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
      metaKey: true,
    }),
  );
  await frames();
  assert(
    !state().editingTextId &&
      domElement("text")!.textContent === "Typed in Browser",
    "Inline text commit failed",
  );
  log("PASS Inline Text");
  state().setCodeOpen(true);
  await until(() => !!document.querySelector(".cm-editor"), "CodeMirror");
  (document.querySelector('[role="tab"]') as HTMLButtonElement).click();
  const view = EditorView.findFromDOM(
    document.querySelector(".cm-editor") as HTMLElement,
  )!;
  const original = view.state.doc.toString();
  const pos = original.indexOf("Typed in Browser");
  assert(pos >= 0, "Code did not follow canvas");
  view.dispatch({
    changes: { from: pos, to: pos + 16, insert: "Code Changed" },
    userEvent: "input.type",
  });
  await until(
    () => domElement("text")?.textContent === "Code Changed",
    "code applied",
  );
  log("PASS Code Edits");
  state().setCodeOpen(false);
  useEditor.setState({
    stylePreview: { id: "board", maxWidth: 375, state: "default" },
  });
  await frames();
  assert(
    domElement("box")!.ownerDocument.defaultView!.getComputedStyle(
      domElement("box")!,
    ).backgroundColor === "rgb(0, 128, 0)",
    "Responsive CSS not applied",
  );
  useEditor.setState({ stylePreview: null });
  await frames();
  log("PASS Responsive Rendering");
  assert(
    document.querySelector("iframe.artboard-frame")?.getAttribute("sandbox") ===
      "allow-same-origin",
    "Artboard allows scripts",
  );
  assert(
    !document.body.dataset.embedEscaped &&
      !domElement("board")!.ownerDocument.body.dataset.embedEscaped,
    "Nested embed escaped sandbox",
  );
  log("PASS Safe Embeds");
  await saveNow();
  const response = await fetch(`/__plastic/project/${file}`);
  const disk = (await response.json()).files;
  assert(disk["index.html"].includes("Code Changed"), "Text not persisted");
  flushSync(() => root.render(null));
  await frames();
  flushSync(() => root.render(<Editor projectId={file} />));
  await until(
    () => domElement("text")?.textContent === "Code Changed",
    "reload persisted text",
  );
  log("PASS Persistence / Remount");
  // Real workspace write while a designer transaction is active; Vite's external-change feed queues it.
  await saveNow();
  const saved = (await (await fetch(`/__plastic/project/${file}`)).json())
    .files;
  state().begin();
  state().preview((doc) => ({ ...doc, title: "Designer Title" }));
  const incoming = {
    ...saved,
    "styles.css": saved["styles.css"] + "\n.box{border-radius:17px}",
  };
  const write = await fetch(`/__plastic/project/${file}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: incoming, expected: saved }),
  });
  assert(write.ok, "Agent fixture write failed");
  await new Promise((r) => setTimeout(r, 700));
  assert(state().tx, "External change ended active gesture");
  state().commit("Designer Edit");
  await until(
    () =>
      domElement("box")!.ownerDocument.defaultView!.getComputedStyle(
        domElement("box")!,
      ).borderRadius === "17px",
    "agent update merged",
  );
  assert(
    state().doc.title === "Designer Title",
    "Agent update discarded designer edit",
  );
  await saveNow();
  const merged = (await (await fetch(`/__plastic/project/${file}`)).json())
    .files;
  assert(
    merged["styles.css"].includes("17px") &&
      merged["index.html"].includes("Designer Title"),
    "Merged changes not persisted",
  );
  log("PASS Designer / Agent Concurrency");
  log("COMPLETE: 10 browser interaction checks. Fixture: " + file);
}
function largeFiles() {
  const boards = Array.from({ length: 24 }, (_, i) =>
    frameHtml(
      i === 0 ? "board" : `board-${i}`,
      Array.from(
        { length: 120 },
        (_, j) =>
          `<article data-pl-id="card-${i}-${j}" class="card"><h3>Card ${j}</h3><p>Imported responsive content</p><span class="pulse">Live</span></article>`,
      ).join(""),
    ),
  ).join("");
  const ids = Array.from({ length: 24 }, (_, i) =>
    i === 0 ? "board" : `board-${i}`,
  );
  const metadata = {
    format: "plastic",
    version: 2,
    pages: [{ file: "index.html", name: "Page 1" }],
    files: { styles: "styles.css", tokens: "tokens.css" },
    canvas: {
      viewport: { x: 40, y: 40, zoom: 0.8 },
      activePage: "index.html",
      frames: Object.fromEntries(
        ids.map((id, i) => [id, { x: i * 820, y: 0 }]),
      ),
    },
    layers: { names: {}, collapsed: ids },
  };
  return {
    "project.json": JSON.stringify(metadata),
    "index.html": boards,
    "styles.css":
      ".board{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:20px;width:720px;box-sizing:border-box;background:white}.card{padding:12px;background:#eee;color:#222}.pulse{display:inline-block;animation:pulse 1s infinite alternate}@keyframes pulse{to{opacity:.3}}@media(max-width:400px){.board{grid-template-columns:1fr}}",
  };
}
async function profile(load: boolean) {
  if (load) await open(largeFiles(), "Browser Check — Large Import");
  assert(
    state().doc.title === "Browser Check — Large Import",
    "Load the large fixture first",
  );
  state().select([]);
  state().setViewport({ x: 40, y: 40, zoom: 0.8 });
  await frames();
  const samples: number[] = [];
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) =>
    list.getEntries().forEach((e) => longTasks.push(e.duration)),
  );
  observer.observe({ entryTypes: ["longtask"] });
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    state().select(i % 2 ? [] : ["board"]);
    await frames();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const heap = (
    performance as Performance & { memory?: { usedJSHeapSize: number } }
  ).memory?.usedJSHeapSize;
  const inputs: number[] = [],
    edits: number[] = [];
  const canvas = document.querySelector(".canvas")!;
  const rootBox = clientBox("board");
  const unchanged = domElement("card-23-0");
  const heading = getElement(state().doc, "card-0-0")!.children[0]!;
  for (let i = 0; i < 15; i++) {
    state().select([]);
    await frames();
    const input = performance.now();
    await gesture(canvas, rootBox.x + 4, rootBox.y + 4);
    inputs.push(performance.now() - input);
    assert(
      state().selection.includes("board"),
      "Profile pointer selection failed",
    );
    const edit = performance.now();
    state().apply(
      "Profile Text Edit",
      (doc) => setText(doc, heading, `Edited ${i}`),
      { coalesce: "profile-edit" },
    );
    await frames();
    edits.push(performance.now() - edit);
  }
  assert(
    domElement("card-23-0") === unchanged,
    "Unrelated artboard DOM was recreated",
  );
  inputs.sort((a, b) => a - b);
  edits.sort((a, b) => a - b);
  const data = {
    file,
    roots: state().doc.pages[0]!.roots.length,
    nodes: Object.keys(state().doc.nodes).length,
    selectionToTwoAnimationFramesMs: {
      median: samples[15],
      p95: samples[28],
      max: samples[29],
    },
    pointerDispatchToTwoAnimationFramesMs: {
      median: inputs[7],
      p95: inputs[14],
    },
    dirtyRootTextEditToTwoAnimationFramesMs: {
      median: edits[7],
      p95: edits[14],
    },
    longTasks: longTasks.length,
    longTaskMs: longTasks.reduce((a, b) => a + b, 0),
    usedJSHeapMiB: heap ? Math.round(heap / 1048576) : null,
    iframeCount: document.querySelectorAll(".artboard-frame").length,
  };
  observer.disconnect();
  log(JSON.stringify(data));
  const offscreen = domElement("board-23")!;
  const pulse = offscreen.querySelector<HTMLElement>(".pulse")!;
  const animation = pulse.getAnimations()[0]!;
  assert(
    animation && animation.playState === "running",
    "Offscreen animation was stopped",
  );
  const time = Number(animation.currentTime);
  await new Promise((r) => setTimeout(r, 150));
  assert(
    Number(animation.currentTime) > time,
    "Offscreen animation timeline was frozen",
  );
  useEditor.setState({
    stylePreview: { id: "board-23", maxWidth: 375, state: "default" },
  });
  await frames();
  assert(
    offscreen.ownerDocument
      .defaultView!.getComputedStyle(offscreen)
      .gridTemplateColumns.split(" ").length === 1,
    "Offscreen responsive preview failed",
  );
  useEditor.setState({ stylePreview: null });
  state().setViewport({ x: 40 - 23 * 820 * 0.8, y: 40, zoom: 0.8 });
  await frames();
  assert(
    pulse.getAnimations()[0] === animation && animation.playState === "running",
    "Panning recreated or stopped animation",
  );
  assert(
    offscreen.ownerDocument
      .defaultView!.getComputedStyle(offscreen)
      .gridTemplateColumns.split(" ").length === 4,
    "Responsive layout did not restore after pan",
  );
  assert(
    document.querySelectorAll(".artboard-frame").length === 24,
    "Offscreen artboards were unmounted",
  );
  log(
    "PASS Offscreen Animation Continuity, Responsive Preview, Pan and Mounted DOM",
  );
  state().setViewport({ x: 40, y: 40, zoom: 0.8 });
  state().select([]);
  await frames();
  log(
    "PROFILE READY: collect CDP Performance metrics over a 5s idle interval. CSS animations remain active.",
  );
}
for (const [id, run] of [
  ["run", interactions],
  ["profile", () => profile(true)],
  ["repeat", () => profile(false)],
] as const) {
  document.getElementById(id)!.onclick = async () => {
    report.length = 0;
    log("Running…");
    const buttons = [...checks.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await run();
    } catch (e) {
      log("FAIL: " + (e instanceof Error ? e.stack : String(e)));
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  };
}
