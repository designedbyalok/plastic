/** Ask the browser's cascade to choose a diagnostic marker, rather than approximating specificity. */
import postcss, { type Declaration, type Root, type Rule } from 'postcss';
import safeParse from 'postcss-safe-parser';
import valueParser from 'postcss-value-parser';
import selectorParser from 'postcss-selector-parser';
import { serializeStyleSheet, serializeTokenSheet } from '../document/css.ts';
import type { DesignDocument } from '../document/types.ts';

export interface StyleSource {
  readonly file: string;
  readonly line: number;
  readonly selector: string;
  readonly contexts: readonly string[];
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  readonly inheritedFrom?: string;
}
export interface Provenance {
  readonly property: string;
  readonly computed: string;
  readonly source: StyleSource | null;
  readonly notes: readonly string[];
  readonly tokens: readonly { name: string; computed: string; source: StyleSource | null }[];
}
interface SheetInput {
  file: string;
  original: string;
  rendered: string;
}
export interface DiagnosticSheet {
  css: string;
  sources: ReadonlyMap<string, StyleSource>;
  notes: readonly string[];
}

// Non-inherited properties use a non-inheriting marker. These common text properties and
// custom properties inherit; unknown properties are kept conservative instead of guessing.
const INHERITED = new Set([
  'color',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-variant',
  'font-kerning',
  'font-feature-settings',
  'font-variation-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'text-shadow',
  'white-space',
  'visibility',
  'cursor',
  'direction',
  'writing-mode',
  'list-style',
  'list-style-type',
  'list-style-position',
  'list-style-image',
  'border-collapse',
  'border-spacing',
  'fill',
  'stroke',
  'stroke-width',
  'text-rendering',
  'color-scheme',
]);
const parse = (css: string) => safeParse(css) as Root;

export function variableReferences(value: string): string[] {
  const names = new Set<string>();
  valueParser(value).walk((node) => {
    if (node.type !== 'function' || node.value !== 'var') return;
    const name = node.nodes.find((n) => n.type !== 'space' && n.type !== 'comment');
    if (name?.type === 'word' && name.value.startsWith('--')) names.add(name.value);
  });
  return [...names];
}

/** Keep grouping/selector structure, reducing declarations to one private marker per source. */
export function diagnosticSheet(
  inputs: readonly SheetInput[],
  prop: string,
  marker: string,
  owner: Document,
): DiagnosticSheet {
  const sources = new Map<string, StyleSource>(),
    notes = new Set<string>();
  const css: string[] = [];
  const scratch = owner.createElement('div').style;
  const relevant = (d: Declaration) => {
    if (d.prop === prop || (!prop.startsWith('--') && d.prop === 'all')) return true;
    // Let native CSSOM expand shorthands. 'initial' avoids unresolved var() shorthand values.
    scratch.cssText = '';
    scratch.setProperty(d.prop, 'initial');
    return scratch.getPropertyValue(prop) !== '';
  };
  for (const input of inputs) {
    const original = parse(input.original),
      rendered = parse(input.rendered);
    const originals: Rule[] = [];
    original.walkRules((r) => {
      originals.push(r);
    });
    let index = 0;
    rendered.walkRules((rule) => {
      const authored = originals[index++] ?? rule;
      try {
        selectorParser((selectors) =>
          selectors.walkAttributes((a) => {
            if (a.attribute === 'style')
              notes.add('Selectors that inspect inline style text cannot be traced reliably.');
          }),
        ).processSync(authored.selector);
      } catch {
        notes.add('This selector syntax could not be traced.');
      }
      const declarations = rule.nodes.filter((n): n is Declaration => n.type === 'decl');
      const candidates = declarations.filter((d) => {
        if (!relevant(d)) return false;
        scratch.cssText = d.toString();
        return scratch.getPropertyValue(d.prop) !== '';
      });
      const selected = [...candidates].reverse().find((d) => d.important) ?? candidates.at(-1);
      for (const d of declarations) d.remove();
      if (!selected) return;
      const contexts: string[] = [];
      let parent = authored.parent;
      while (parent && parent.type !== 'root') {
        if (parent.type === 'atrule') contexts.unshift(`@${parent.name} ${parent.params}`.trim());
        parent = parent.parent;
      }
      const id = `source-${sources.size}`;
      const source: StyleSource = {
        file: input.file,
        line: authored.source?.start?.line ?? 1,
        selector: authored.selector,
        contexts,
        property: selected.prop,
        value: selected.value,
        important: selected.important ?? false,
      };
      sources.set(id, source);
      // revert and revert-layer must participate in the diagnostic cascade just as in the design.
      rule.append(
        postcss.decl({
          prop: marker,
          value: /^(revert|revert-layer)$/.test(selected.value) ? selected.value : id,
          important: selected.important,
        }),
      );
    });
    rendered.walkAtRules((rule) => {
      const name = rule.name.toLowerCase();
      if (name === 'import') notes.add('Imported external styles are not traced.');
      if (name === 'namespace') notes.add('Namespaced styles cannot be traced reliably.');
      if (name === 'layer' && !rule.params && rule.nodes)
        notes.add('Anonymous cascade layers cannot be traced reliably.');
      if (name === 'property' && rule.params === prop)
        notes.add('Custom property registration may affect inheritance.');
      if (name.endsWith('keyframes') || ['font-face', 'property', 'import'].includes(name)) rule.remove();
    });
    css.push(rendered.toString());
  }
  return { css: css.join('\n'), sources, notes: [...notes] };
}

interface Markers {
  inherited: string;
  direct: string;
}
const markers = new WeakMap<Document, Markers>();
const diagnostics = new WeakMap<Document, { signature: string; entries: Map<string, DiagnosticSheet> }>();
function markerNames(owner: Document): Markers | null {
  const cached = markers.get(owner);
  if (cached) return cached;
  const api = (owner.defaultView as (Window & { CSS?: typeof CSS }) | null)?.CSS;
  if (!api?.registerProperty) return null;
  const prefix = `--plastic-source-${crypto.randomUUID().replace(/-/g, '')}`;
  const names = { inherited: `${prefix}-inherited`, direct: `${prefix}-direct` };
  api.registerProperty({ name: names.inherited, syntax: '*', inherits: true, initialValue: 'none' });
  api.registerProperty({ name: names.direct, syntax: '*', inherits: false, initialValue: 'none' });
  markers.set(owner, names);
  return names;
}

function elementLabel(el: Element): string {
  return `${el.localName}${el.id ? `#${el.id}` : el.classList.length ? `.${Array.from(el.classList).join('.')}` : ''}`;
}

function trace(
  doc: DesignDocument,
  element: HTMLElement,
  prop: string,
): { source: StyleSource | null; notes: string[]; origin?: HTMLElement } {
  const owner = element.ownerDocument,
    win = owner.defaultView;
  const names = markerNames(owner);
  if (!win || !names) return { source: null, notes: ['Source tracing is unavailable in this browser.'] };
  const marker = prop.startsWith('--') || INHERITED.has(prop) ? names.inherited : names.direct;
  const originals: Record<string, string> = {
    'styles.css': serializeStyleSheet(doc.styles),
    'tokens.css': serializeTokenSheet(doc.tokens),
  };
  const inputs = Array.from(owner.querySelectorAll<HTMLStyleElement>('style[data-plastic-source]')).map((el) => ({
    file: el.dataset.plasticSource!,
    original: originals[el.dataset.plasticSource!] ?? '',
    rendered: el.textContent ?? '',
  }));
  const signature = JSON.stringify(inputs);
  let cached = diagnostics.get(owner);
  if (!cached || cached.signature !== signature) {
    cached = { signature, entries: new Map() };
    diagnostics.set(owner, cached);
  }
  let diagnostic = cached.entries.get(prop);
  if (!diagnostic) {
    diagnostic = diagnosticSheet(inputs, prop, marker, owner);
    if (cached.entries.size >= 32) cached.entries.delete(cached.entries.keys().next().value!);
    cached.entries.set(prop, diagnostic);
  }
  const sources = new Map(diagnostic.sources);
  const probe = owner.createElement('style');
  probe.dataset.plasticProbe = '';
  if (marker === names.inherited) {
    const css = parse(diagnostic.css);
    css.walkDecls(marker, (d) => {
      d.cloneAfter({ prop: names.direct });
    });
    probe.textContent = css.toString();
  } else probe.textContent = diagnostic.css;
  const inline: { el: HTMLElement; original: string | null }[] = [];
  try {
    // Preserve inline cascade priority on the target and ancestors, including explicit inheritance.
    let current: HTMLElement | null = element;
    while (current) {
      const original = current.getAttribute('style');
      const rule = original ? `a{${original}}` : '';
      const authored = rule
        ? diagnosticSheet([{ file: 'HTML inline style', original: rule, rendered: rule }], prop, marker, owner)
            .sources.values()
            .next().value
        : null;
      if (authored) {
        const value = authored.value;
        const id = `inline-${sources.size}`;
        const priority = authored.important ? 'important' : '';
        sources.set(id, { ...authored, line: 0, selector: elementLabel(current) });
        inline.push({ el: current, original });
        current.style.setProperty(marker, /^(revert|revert-layer)$/.test(value) ? value : id, priority);
        if (marker === names.inherited)
          current.style.setProperty(names.direct, /^(revert|revert-layer)$/.test(value) ? value : id, priority);
      }
      current = current.parentElement;
    }
    owner.head.appendChild(probe);
    const id = win.getComputedStyle(element).getPropertyValue(marker).trim();
    let source = sources.get(id) ?? null;
    let origin = element;
    if (source && marker === names.inherited) {
      let current: HTMLElement | null = element;
      while (current?.parentElement && win.getComputedStyle(current).getPropertyValue(names.direct).trim() !== id)
        current = current.parentElement;
      if (current !== element) source = { ...source, inheritedFrom: elementLabel(current!) };
      origin = current!;
    }
    // Avoid identifying a winner where duplicated anonymous layers/imports could change it.
    if (diagnostic.notes.length) source = null;
    return { source, notes: [...diagnostic.notes], origin };
  } finally {
    probe.remove();
    for (const entry of inline) {
      if (entry.original === null) entry.el.removeAttribute('style');
      else entry.el.setAttribute('style', entry.original);
    }
  }
}

/** Computed values always come from the live iframe, including responsive/state previews. */
export function styleProvenance(doc: DesignDocument, element: HTMLElement, property: string): Provenance {
  const prop = property.trim();
  const win = element.ownerDocument.defaultView!;
  const computed = win.getComputedStyle(element).getPropertyValue(prop).trim();
  if (!/^(--[\w-]+|[a-z][a-z0-9-]*)$/.test(prop))
    return { property: prop, computed, source: null, notes: [], tokens: [] };
  const result = trace(doc, element, prop);
  const tokens: { name: string; computed: string; source: StyleSource | null }[] = [];
  const seen = new Set<string>();
  const follow = (value: string, context: HTMLElement) => {
    for (const name of variableReferences(value)) {
      if (seen.has(name) || seen.size >= 12) continue;
      seen.add(name);
      const token = trace(doc, context, name);
      tokens.push({
        name,
        computed: win.getComputedStyle(context).getPropertyValue(name).trim(),
        source: token.source,
      });
      if (token.source) follow(token.source.value, token.origin ?? context);
    }
  };
  if (result.source) follow(result.source.value, result.origin ?? element);
  const animated = element.getAnimations?.().some((a) => a.playState === 'running');
  return {
    property: prop,
    computed,
    source: result.source,
    notes: [
      ...result.notes,
      ...(animated ? ['Animation or transition is active; this is the underlying declaration.'] : []),
    ],
    tokens,
  };
}
