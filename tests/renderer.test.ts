// @vitest-environment jsdom
import { expect, it } from "vitest";
import { DomRenderer } from "../src/canvas/renderer";
import { emptyDocument, instantiate } from "../src/document/factory";
import { insertRoot, setText } from "../src/document/ops";
it("reports only changed DOM roots and preserves untouched sibling trees", () => {
  let doc = emptyDocument();
  const a = instantiate(doc, {
    tag: "div",
    children: [{ tag: "p", children: ["First"] }],
  });
  doc = insertRoot(a.doc, "index.html", 0, a.id);
  const b = instantiate(doc, {
    tag: "div",
    children: [{ tag: "p", children: ["Second"] }],
  });
  doc = insertRoot(b.doc, "index.html", 1, b.id);
  const mountA = document.createElement("div"),
    mountB = document.createElement("div");
  document.body.append(mountA, mountB);
  const first = new DomRenderer(mountA),
    second = new DomRenderer(mountB);
  try {
    expect(first.render(doc, a.id)).toBe(true);
    expect(second.render(doc, b.id)).toBe(true);
    const untouched = mountB.firstChild;
    expect(first.render({ ...doc, title: "Metadata Only" }, a.id)).toBe(false);
    const node = doc.nodes[a.id];
    if (node?.kind !== "element") throw new Error("Missing root");
    doc = setText(doc, node.children[0]!, "Changed");
    expect(first.render(doc, a.id)).toBe(true);
    expect(mountA.textContent).toBe("Changed");
    expect(second.render(doc, b.id)).toBe(false);
    expect(mountB.firstChild).toBe(untouched);
    second.invalidate();
    expect(second.render(doc, b.id)).toBe(true);
  } finally {
    first.dispose();
    second.dispose();
    mountA.remove();
    mountB.remove();
  }
});
