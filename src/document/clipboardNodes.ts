/** Paste a trusted in-memory Plastic selection without flattening its CSS or structure. */
import { createId } from './ids.ts';
import { takenClassNames, uniqueClassName } from './factory.ts';
import { parseStyleSheet, renameStyleClass, serializeStyleSheet } from './css.ts';
import safeParse from 'postcss-safe-parser';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import { getElement, subtreeIds } from './tree.ts';
import { insertChild, insertRoot, setFrame } from './ops.ts';
import type { DesignDocument, DocNode, NodeId, Point } from './types.ts';

export function pastePlasticNodes(doc: DesignDocument, source: DesignDocument, roots: readonly NodeId[],
  parent: NodeId | null, page: string, position: Point, preserveIds = false, assetBase?: string): { doc: DesignDocument; ids: NodeId[] } {
  if (parent && !getElement(doc, parent)) throw new Error('Paste destination no longer exists.');
  const selected = new Set(roots.flatMap((id) => subtreeIds(source, id)));
  const keep = preserveIds && [...selected].every((id) => !doc.nodes[id]);
  const idMap = new Map([...selected].map((id) => [id, keep ? id : createId()]));
  const classes = new Set([...selected].flatMap((id) => {
    const node = source.nodes[id]; return node?.kind === 'element' ? node.classes : [];
  }));
  const classMap = new Map<string, string>();
  const taken = new Set([...takenClassNames(doc), ...classes]);
  let styled = source;
  for (const cls of classes) {
    // A cut restores shared classes still used by siblings. Copies get independent styles.
    const name = keep ? cls : uniqueClassName(taken, cls);
    taken.add(name); classMap.set(cls, name);
    if (name !== cls) styled = { ...styled, styles: renameStyleClass(styled.styles, cls, name) };
  }
  const nodes: Record<NodeId, DocNode> = { ...doc.nodes };
  const names = { ...doc.names };
  const htmlIds = new Map<string, string>();
  for (const id of selected) {
    const node = source.nodes[id]!;
    if (node.kind === 'element' && node.attrs.id) htmlIds.set(node.attrs.id, keep ? node.attrs.id : `paste-${createId()}`);
  }
  const refs = (value: string) => value.replace(/url\(\s*(['"]?)#([^\s)'" ]+)\1\s*\)/g,
    (match, _quote: string, id: string) => htmlIds.has(id) ? `url(#${htmlIds.get(id)})` : match);
  const absolute = (value: string) => {
    if (!assetBase || !value || value.startsWith('#')) return value;
    try { return new URL(value, assetBase).href; } catch { return value; }
  };
  const cssRefs = (value: string) => {
    const parsed = valueParser(refs(value));
    if (assetBase) parsed.walk((node) => {
      if (node.type === 'function' && node.value.toLowerCase() === 'url') {
        const child = node.nodes[0];
        if (child && (child.type === 'string' || child.type === 'word')) child.value = absolute(child.value);
      }
    });
    return parsed.toString();
  };
  for (const key of selected) {
    const node = source.nodes[key]!, id = idMap.get(key)!;
    if (node.kind === 'text') nodes[id] = { ...node, id };
    else {
      const attrs = { ...node.attrs };
      for (const [attr, value] of Object.entries(attrs)) {
        if (attr === 'id') attrs[attr] = htmlIds.get(value)!;
        else if (['href', 'xlink:href'].includes(attr) && value.startsWith('#')) attrs[attr] = `#${htmlIds.get(value.slice(1)) ?? value.slice(1)}`;
        else if (['for', 'aria-labelledby', 'aria-describedby'].includes(attr)) attrs[attr] = value.split(/\s+/).map((id) => htmlIds.get(id) ?? id).join(' ');
        else if (['src', 'poster', 'href', 'xlink:href'].includes(attr)) attrs[attr] = absolute(value);
        else attrs[attr] = cssRefs(value);
      }
      nodes[id] = { ...node, id, attrs, classes: node.classes.map((cls) => classMap.get(cls)!), children: node.children.map((child) => idMap.get(child)!) };
    }
    if (source.names[key]) names[id] = source.names[key]!;
  }
  // Keep selected class rules, their grouping conditions, font faces and imports. Do not
  // replace unrelated rules in the destination with a stale whole-project snapshot.
  const css = safeParse(serializeStyleSheet(styled.styles));
  const mapped = new Set(classMap.values());
  css.walkRules((rule) => {
    let relevant = false;
    try { selectorParser((selectors) => selectors.walkClasses((cls) => { if (mapped.has(cls.value)) relevant = true; })).processSync(rule.selector); }
    catch { relevant = false; }
    if (!relevant && rule.parent?.type !== 'atrule') rule.remove();
    else if (!relevant && rule.parent?.type === 'atrule' && !rule.parent.name.endsWith('keyframes')) rule.remove();
  });
  css.walkDecls((decl) => { decl.value = cssRefs(decl.value); });
  // Imports must precede ordinary declarations in the resulting exported stylesheet.
  const imports: string[] = [];
  css.walkAtRules('import', (rule) => { imports.push(rule.toString() + ';'); rule.remove(); });
  const existingCss = serializeStyleSheet(doc.styles);
  let next: DesignDocument = { ...doc, nodes, names,
    tokens: { ...doc.tokens, values: { ...source.tokens.values, ...doc.tokens.values } },
    styles: parseStyleSheet(imports.filter((rule) => !existingCss.includes(rule.replace(/;$/, ''))).join('\n') + '\n' + existingCss + '\n' + css.toString()) };
  const ids = roots.map((id) => idMap.get(id)!);
  ids.forEach((id, index) => {
    if (parent) next = insertChild(next, parent, getElement(next, parent)!.children.length, id);
    else {
      const target = next.pages.find((p) => p.file === page);
      if (!target) throw new Error('Paste destination no longer exists.');
      next = insertRoot(next, page, target.roots.length, id);
      next = setFrame(next, id, { x: position.x + index * 32, y: position.y + index * 32 });
    }
  });
  if (source.components) {
    const definitions = { ...next.components?.definitions }, instances = { ...next.components?.instances };
    for (const [id, name] of Object.entries(source.components.definitions)) if (idMap.has(id)) definitions[idMap.get(id)!] = name;
    for (const [id, link] of Object.entries(source.components.instances)) {
      const copy = idMap.get(id);
      if (!copy) {
        // Cutting a main temporarily detaches its instances; restore links on its first paste.
        if (keep && selected.has(link.source) && next.nodes[id]) instances[id] = link;
        continue;
      }
      const baseline = idMap.has(link.source) ? link.baseline.replace(/data-pl-id="([^"]+)"/g, (match, key: string) => idMap.has(key) ? `data-pl-id="${idMap.get(key)}"` : match)
        .replace(/class="([^"]*)"/g, (_match, value: string) => `class="${value.split(/\s+/).map((cls) => classMap.get(cls) ?? cls).join(' ')}"`) : link.baseline;
      instances[copy] = { ...link, baseline, source: idMap.get(link.source) ?? link.source,
        elements: Object.fromEntries(Object.entries(link.elements).map(([key, value]) => [idMap.get(key) ?? key, idMap.get(value) ?? createId()])) };
    }
    next = { ...next, components: { definitions, instances } };
  }
  const frameGuides = source.pages.flatMap((p) => p.guides ?? []).filter((g) => g.frame && idMap.has(g.frame));
  if (frameGuides.length) next = { ...next, pages: next.pages.map((p) => ({ ...p, guides: [
    ...(p.guides ?? []).filter((g) => !keep || !frameGuides.some((sourceGuide) => sourceGuide.id === g.id)),
    ...(p.file === page ? frameGuides.map((g) => ({ ...g, id: keep ? g.id : createId(), frame: idMap.get(g.frame!)! })) : []),
  ] })) };
  return { doc: next, ids };
}
