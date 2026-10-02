import { diff3Merge } from 'node-diff3';
import safeParse from 'postcss-safe-parser';
import type { ChildNode, Root } from 'postcss';
import type { ProjectFiles } from '../serialization/index.ts';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Values edited on both sides keep the active editor's value; unchanged fields take incoming. */
function value(base: unknown, local: unknown, incoming: unknown): unknown {
  if (equal(local, base)) return incoming;
  if (equal(incoming, base) || equal(local, incoming)) return local;
  if (record(local) && record(incoming) && (base === undefined || record(base))) {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of new Set([...Object.keys(base ?? {}), ...Object.keys(local), ...Object.keys(incoming)])) {
      const merged = value(base?.[key], local[key], incoming[key]);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(incoming)) {
    // Page records have stable file identities, unlike positional JSON arrays.
    if ([...base, ...local, ...incoming].every((v) => record(v) && typeof v.file === 'string')) {
      const byFile = (items: Record<string, unknown>[]) => Object.fromEntries(items.map((v) => [v.file, v]));
      const records = value(byFile(base), byFile(local), byFile(incoming)) as Record<string, unknown>;
      return order(
        base.map((v) => v.file),
        local.map((v) => v.file),
        incoming.map((v) => v.file),
      )
        .filter((key) => records[key] !== undefined)
        .map((key) => records[key]);
    }
    if ([...base, ...local, ...incoming].every((v) => typeof v === 'string')) return order(base, local, incoming);
  }
  return local;
}

/** Diff3 handles independent ordering edits. Concurrent insertions keep both, once each. */
function order(base: string[], local: string[], incoming: string[]): string[] {
  if (equal(local, base)) return incoming;
  if (equal(incoming, base) || equal(local, incoming)) return local;
  const result = diff3Merge(local, base, incoming).flatMap((block) => {
    if (block.ok) return block.ok;
    const c = block.conflict!;
    // Incoming deletions still apply to unchanged local entries in an overlapping region.
    const kept = c.a.filter((key) => !c.o.includes(key) || c.b.includes(key));
    return [...kept, ...c.b.filter((key) => !c.o.includes(key))];
  });
  return [...new Set(result)];
}

interface Entry<T> {
  fields: Record<string, unknown>;
  parent: string;
  children: string[];
  source: string;
  template: T;
}
type Tree<T> = Map<string, Entry<T>>;

function mergeTree<T>(base: Tree<T>, local: Tree<T>, incoming: Tree<T>): Tree<T> {
  const merged: Tree<T> = new Map();
  const retained = new Set<string>();
  const retainSubtree = (id: string) => {
    if (retained.has(id)) return;
    retained.add(id);
    for (const child of local.get(id)?.children ?? []) retainSubtree(child);
  };
  for (const [id, entry] of local) {
    const b = base.get(id);
    if (b && !incoming.has(id) && (entry.source !== b.source || entry.parent !== b.parent)) retainSubtree(id);
  }
  for (const key of new Set([...base.keys(), ...local.keys(), ...incoming.keys()])) {
    const b = base.get(key),
      l = local.get(key),
      r = incoming.get(key);
    // Subtree equality matters: a remotely deleted container survives a local edit inside it.
    if (!l && b) continue;
    if (!r && b && !retained.has(key)) continue;
    const chosen = l ?? r;
    if (!chosen) continue;
    merged.set(
      key,
      l && r
        ? {
            ...chosen,
            fields: value(b?.fields, l.fields, r.fields) as Record<string, unknown>,
            parent: value(b?.parent, l.parent, r.parent) as string,
            children: order(b?.children ?? [], l.children, r.children),
          }
        : chosen,
    );
  }
  // Concurrent reparenting can create a cycle although each input tree is valid.
  // Repair the entire cycle using the active editor's structure, then add missing ancestors.
  const visited = new Set<string>();
  for (const key of merged.keys()) {
    const chain = new Set<string>();
    let cursor = key;
    while (cursor && merged.has(cursor) && !visited.has(cursor)) {
      if (chain.has(cursor)) {
        for (const id of chain) {
          const entry = merged.get(id)!;
          entry.parent = local.get(id)?.parent ?? '';
        }
        break;
      }
      chain.add(cursor);
      cursor = merged.get(cursor)!.parent;
    }
    for (const id of chain) visited.add(id);
  }
  for (const entry of merged.values()) {
    if (entry.parent && !merged.has(entry.parent)) entry.parent = '';
  }
  const byParent = new Map<string, string[]>();
  for (const [id, entry] of merged) {
    const siblings = byParent.get(entry.parent) ?? [];
    siblings.push(id);
    byParent.set(entry.parent, siblings);
  }
  for (const [id, entry] of merged) {
    entry.children = [...new Set([...entry.children, ...(byParent.get(id) ?? [])])].filter(
      (child) => merged.get(child)?.parent === id,
    );
  }
  return merged;
}

function children<T>(tree: Tree<T>, key: string): string[] {
  return tree.get(key)!.children;
}

function htmlTree(html: string): { tree: Tree<Node>; dom: Document } {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const tree: Tree<Node> = new Map();
  const visit = (node: Node, key: string, parent: string) => {
    const element = node.nodeType === 1 ? (node as Element) : null;
    const fields: Record<string, unknown> = element
      ? {
          tag: element.localName,
          namespace: element.namespaceURI,
          attrs: Object.fromEntries(Array.from(element.attributes, (a) => [a.name, a.value])),
        }
      : { text: node.textContent ?? '' };
    const ids: string[] = [];
    const counts = new Map<string, number>();
    for (const child of Array.from(node.childNodes)) {
      // Formatting whitespace is regenerated by project serialization; it is not design text.
      if (child.nodeType === 3 && !child.textContent?.trim() && element && element.childElementCount) continue;
      if (child.nodeType !== 1 && child.nodeType !== 3 && child.nodeType !== 8) continue;
      const el = child.nodeType === 1 ? (child as Element) : null;
      const identity = el?.getAttribute('data-pl-id');
      const kind = el?.localName ?? (child.nodeType === 8 ? '#comment' : '#text');
      const n = counts.get(kind) ?? 0;
      counts.set(kind, n + 1);
      let id = identity ? `id:${identity}` : `${key}/${kind}:${n}`;
      // Malformed duplicate IDs fall back to a structural key rather than aliasing nodes.
      if (tree.has(id)) id = `${key}/${kind}:${n}`;
      ids.push(id);
      visit(child, id, key);
    }
    tree.set(key, {
      fields,
      parent,
      children: ids,
      source: element?.outerHTML ?? node.textContent ?? '',
      template: node,
    });
  };
  visit(dom.documentElement, 'document', '');
  return { tree, dom };
}

function mergeHTML(base: string, local: string, incoming: string): string {
  const b = htmlTree(base),
    l = htmlTree(local),
    r = htmlTree(incoming);
  const tree = mergeTree(b.tree, l.tree, r.tree);
  for (const [id, entry] of tree) {
    const original = b.tree.get(id),
      active = l.tree.get(id),
      remote = r.tree.get(id);
    if (!active || !remote) continue;
    if (entry.template.nodeType === 3 && original && typeof original.fields.text === 'string') {
      const tokenize = (text: unknown) => String(text).match(/\s+|[^\s]+/g) ?? [];
      entry.fields.text = diff3Merge(
        tokenize(active.fields.text),
        tokenize(original.fields.text),
        tokenize(remote.fields.text),
      )
        .flatMap((block) => block.ok ?? block.conflict!.a)
        .join('');
    }
    const attrs = entry.fields.attrs as Record<string, string> | undefined;
    if (!attrs) continue;
    const ba = (original?.fields.attrs ?? {}) as Record<string, string>;
    const la = active.fields.attrs as Record<string, string>,
      ra = remote.fields.attrs as Record<string, string>;
    if (la.class !== undefined && ra.class !== undefined) {
      attrs.class = order(
        (ba.class ?? '').split(/\s+/).filter(Boolean),
        la.class.split(/\s+/).filter(Boolean),
        ra.class.split(/\s+/).filter(Boolean),
      ).join(' ');
    }
    if (la.style !== undefined && ra.style !== undefined && la.style !== ba.style && ra.style !== ba.style) {
      const merged = mergeCSS(`x{${ba.style ?? ''}}`, `x{${la.style}}`, `x{${ra.style}}`);
      attrs.style = merged.slice(merged.indexOf('{') + 1, merged.lastIndexOf('}'));
    }
  }
  const render = (key: string): Node => {
    const entry = tree.get(key)!;
    const f = entry.fields;
    if (entry.template.nodeType === 8) return l.dom.createComment(String(f.text));
    if (entry.template.nodeType === 3) return l.dom.createTextNode(String(f.text));
    const node = l.dom.createElementNS(f.namespace as string, f.tag as string);
    for (const [name, val] of Object.entries(f.attrs as Record<string, string>)) node.setAttribute(name, val);
    for (const child of children(tree, key)) node.appendChild(render(child));
    return node;
  };
  return '<!doctype html>\n' + (render('document') as Element).outerHTML + '\n';
}

function cssTree(css: string): Tree<ChildNode | Root> {
  const tree: Tree<ChildNode | Root> = new Map();
  const root = safeParse(css) as Root;
  const visit = (node: ChildNode | Root, key: string, parent: string) => {
    const fields =
      node.type === 'decl'
        ? { value: node.value, important: node.important ?? false }
        : node.type === 'comment'
          ? { text: node.text }
          : {};
    const ids: string[] = [],
      counts = new Map<string, number>();
    const totals = new Map<string, number>();
    if ('nodes' in node && node.nodes)
      for (const child of node.nodes) {
        if (child.type === 'decl') totals.set(child.prop, (totals.get(child.prop) ?? 0) + 1);
      }
    if ('nodes' in node && node.nodes)
      for (const child of node.nodes) {
        const label =
          child.type === 'rule'
            ? `rule:${child.selector}`
            : child.type === 'atrule'
              ? `at:${child.name}:${child.params}`
              : child.type === 'decl'
                ? `decl:${child.prop}`
                : 'comment';
        const n = counts.get(label) ?? 0;
        counts.set(label, n + 1);
        // Anchor repeated declarations from the effective (last) value: deleting an earlier
        // fallback must not change the identity of the declaration being edited elsewhere.
        const occurrence = child.type === 'decl' ? totals.get(child.prop)! - n - 1 : n;
        const id = `${key}/${JSON.stringify(label)}:${occurrence}`;
        ids.push(id);
        visit(child, id, key);
      }
    tree.set(key, { fields, parent, children: ids, source: node.toString(), template: node });
  };
  visit(root, 'css', '');
  return tree;
}

function mergeCSS(base: string, local: string, incoming: string): string {
  const tree = mergeTree(cssTree(base), cssTree(local), cssTree(incoming));
  const render = (key: string): ChildNode | Root => {
    const entry = tree.get(key)!;
    const node = entry.template.clone();
    Object.assign(node, entry.fields);
    if ('nodes' in node && node.nodes) {
      node.removeAll();
      for (const child of children(tree, key)) node.append(render(child) as ChildNode);
    }
    return node;
  };
  return render('css').toString();
}

/** Automatic three-way merge of the editor's ordinary web files, without conflict markers. */
export function mergeFiles(base: ProjectFiles, local: ProjectFiles, incoming: ProjectFiles): Record<string, string> {
  const files: Record<string, string> = Object.create(null);
  for (const name of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(incoming)])) {
    const b = base[name],
      l = local[name],
      r = incoming[name];
    let result = l === b ? r : l;
    if (b !== undefined && l !== undefined && r !== undefined && l !== b && r !== b && l !== r) {
      try {
        if (/\.html$/i.test(name) && /<[^>]+>/.test(b)) result = mergeHTML(b, l, r);
        else if (/\.css$/i.test(name)) result = mergeCSS(b, l, r);
        else if (/\.json$/i.test(name))
          result = JSON.stringify(value(JSON.parse(b), JSON.parse(l), JSON.parse(r)), null, 2) + '\n';
        else
          result = diff3Merge(l.split('\n'), b.split('\n'), r.split('\n'))
            .flatMap((block) => block.ok ?? block.conflict!.a)
            .join('\n');
      } catch {
        // Incomplete code-editor syntax keeps the active buffer intact until it can be parsed.
        result = l;
      }
    }
    if (result !== undefined) files[name] = result;
  }
  return files;
}
