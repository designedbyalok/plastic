import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { domElement } from '../../canvas/dom.ts';
import { styleProvenance, type Provenance, type StyleSource } from '../../canvas/provenance.ts';
import type { ElementNode } from '../../document/types.ts';
import { useEditor } from '../../editor/store.ts';
import { Row, Select } from './fields.tsx';

const PROPERTIES = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'width',
  'height',
  'display',
  'gap',
  'padding',
  'margin',
  'border-radius',
  'opacity',
];

function Source({ source }: { source: StyleSource }) {
  return (
    <div className="insp-source-rule">
      <code>{source.selector}</code>
      <span>
        {source.file}
        {source.line ? `:${source.line}` : ''}
      </span>
      {source.contexts.map((context, i) => (
        <code key={i}>{context}</code>
      ))}
      <code>
        {source.property}: {source.value}
        {source.important ? ' !important' : ''}
      </code>
      {source.inheritedFrom && <span>Inherited from {source.inheritedFrom}</span>}
    </div>
  );
}

export function SourceSection({ el }: { el: ElementNode }) {
  const [open, setOpen] = useState(false);
  const doc = useEditor((s) => s.doc);
  const preview = useEditor((s) => s.stylePreview);
  const property = useEditor((s) => s.styleSourceProperty);
  const [result, setResult] = useState<Provenance | null>(null);
  useEffect(() => {
    if (!open) return;
    let frame = 0,
      stopped = false;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (stopped) return;
        const node = domElement(el.id);
        if (!node) return setResult(null);
        try {
          setResult(styleProvenance(doc, node, property));
        } catch {
          setResult({ property, computed: '', source: null, tokens: [], notes: ['Could not trace this value.'] });
        }
      });
    };
    const observer = new ResizeObserver(update);
    const node = domElement(el.id);
    if (node) {
      observer.observe(node);
      observer.observe(node.ownerDocument.documentElement);
    }
    update();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, doc, preview, el.id, property]);
  const cls = el.classes[0];
  return (
    <section className="insp-section insp-source-section">
      <button type="button" className="insp-source-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>Style Source</span>
      </button>
      {open && (
        <div className="insp-body">
          <Row>
            <Select
              ariaLabel="Inspect CSS property"
              value={property}
              options={[...new Set([...PROPERTIES, property])]}
              onChange={(styleSourceProperty) => useEditor.setState({ styleSourceProperty })}
            />
            <code className="insp-source-value" title={result?.computed}>
              {result?.computed || '—'}
            </code>
          </Row>
          <div className="insp-source-body" aria-live="polite">
            {result?.source ? (
              <Source source={result.source} />
            ) : (
              <span>
                {result?.notes.length ? 'Source unavailable' : 'Browser default or no authored declaration traced'}
              </span>
            )}
            {result?.tokens.map((token) => (
              <div key={token.name} className="insp-source-token">
                <code>
                  {token.name} → {token.computed || 'unset / fallback'}
                </code>
                {token.source && <Source source={token.source} />}
              </div>
            ))}
            {result?.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            <p>
              Base controls write to <code>{cls ? `.${cls}` : 'a new class'}</code> in styles.css. Responsive &amp;
              States controls write to their selected rule.
            </p>
            {result?.source &&
              (result.source.file !== 'styles.css' ||
                result.source.selector !== `.${cls}` ||
                result.source.contexts.length > 0) && (
                <p>
                  This source differs from the base edit target. Use Responsive &amp; States for a matching override, or
                  Code to edit this source.
                </p>
              )}
          </div>
        </div>
      )}
    </section>
  );
}
