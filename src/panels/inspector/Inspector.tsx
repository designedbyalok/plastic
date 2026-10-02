import { ChevronDown } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from '../../editor/commands';
import { useEditor } from '../../editor/store';
import { getElement } from '../../document/tree';
import type { ElementNode } from '../../document/types';
import { elementSpec } from '../../elements/registry';
import { AttributesSection, BehaviorSection, ContentSection, ElementSection, TableSection } from './ElementSections';
import {
  BorderSection, ConstraintsSection, CssSection, FillSection, LayoutSection, MarginSection, OpacitySection, RadiusSection, ShadowSection, TextSection,
} from './StyleSections';

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  // Computed-value placeholders read the live DOM; re-read once after new artboards mount.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const rootCount = doc.roots.length;
  useEffect(() => {
    const raf = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(raf);
  }, [rootCount, selection]);

  const elements = selection.map((id) => getElement(doc, id)).filter((el): el is ElementNode => !!el);
  const single = elements.length === 1 ? elements[0]! : null;
  const ids = elements.map((el) => el.id);
  const textual = elements.every((el) => {
    const spec = elementSpec(el.tag);
    return spec.editableText || spec.category === 'text' || spec.category === 'form';
  });

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <InspectorHeader />
      {!elements.length ? (
        <EmptyInspector />
      ) : (
        <div key={ids.join(',')}>
          {single ? (
            <ElementSection el={single} />
          ) : (
            <section className="insp-section">
              <div className="insp-header">
                <span className="insp-title">{elements.length} elements</span>
              </div>
            </section>
          )}
          {single && <ContentSection el={single} />}
          {single && <BehaviorSection el={single} />}
          {single && <TableSection el={single} />}
          <LayoutSection ids={ids} />
          <RadiusSection ids={ids} />
          <OpacitySection ids={ids} />
          <FillSection ids={ids} />
          <TextSection ids={ids} textual={textual} />
          <BorderSection ids={ids} />
          <ShadowSection ids={ids} />
          <MarginSection ids={ids} />
          <ConstraintsSection ids={ids} />
          {single && <CssSection el={single} />}
          {single && <AttributesSection el={single} />}
        </div>
      )}
    </aside>
  );
}

function InspectorHeader() {
  const codeOpen = useEditor((s) => s.codeOpen);
  return (
    <header className="insp-top">
      <SaveStatus />
      <span className="insp-top-actions">
        <ZoomMenu />
        <button type="button" className={`insp-top-button${codeOpen ? ' is-active' : ''}`} aria-pressed={codeOpen} onClick={() => useEditor.getState().setCodeOpen(!codeOpen)} title="Show the HTML and CSS being saved">
          Code
        </button>
      </span>
    </header>
  );
}

function SaveStatus() {
  const status = useEditor((s) => s.saveStatus);
  const dirty = useEditor((s) => s.revision !== s.savedRevision);
  const location = useEditor((s) => s.storageLocation);
  const state = status === 'error' ? 'error' : dirty || status === 'saving' ? 'saving' : 'saved';
  const text = state === 'error' ? 'Save failed' : state === 'saving' ? 'Saving…' : 'Saved';
  return (
    <span className={`insp-save is-${state}`} title={location ? `Files in ${location}/` : undefined}>
      <span className="insp-save-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

const ZOOM_ITEMS = [
  { label: 'Zoom in', kbd: '⌘ +', run: () => zoomBy(1.25) },
  { label: 'Zoom out', kbd: '⌘ −', run: () => zoomBy(0.8) },
  { label: 'Zoom to 100%', kbd: '⇧ 0', run: () => zoomTo(1) },
  { label: 'Zoom to fit', kbd: '⇧ 1', run: zoomToFit },
  { label: 'Zoom to selection', kbd: '⇧ 2', run: zoomToSelection },
];

function ZoomMenu() {
  const zoom = useEditor((s) => s.viewport.zoom);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  return (
    <span className="insp-menu-anchor" ref={ref}>
      <button type="button" className="insp-zoom" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {Math.round(zoom * 100)}%
        <ChevronDown size={12} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="insp-menu" role="menu">
          {ZOOM_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="insp-menu-item"
              onClick={() => {
                item.run();
                setOpen(false);
              }}
            >
              <span>{item.label}</span>
              <kbd>{item.kbd}</kbd>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function EmptyInspector() {
  const doc = useEditor((s) => s.doc);
  const elements = Object.values(doc.nodes).filter((n) => n.kind === 'element').length;
  return (
    <div className="insp-empty">
      <p className="insp-empty-stats">
        {doc.roots.length} artboard{doc.roots.length === 1 ? '' : 's'} · {elements} elements · {Object.keys(doc.styles.rules).length} classes
      </p>
      <dl className="insp-shortcuts">
        {[
          ['F', 'Draw a frame'],
          ['T  H  B  I', 'Text, heading, button, input'],
          ['Double-click', 'Edit text'],
          ['⇧ A', 'Add flex / wrap selection'],
          ['Enter  Esc', 'Into child, up to parent'],
          ['Space', 'Hold to pan'],
          ['⌘ Z  ⇧⌘ Z', 'Undo, redo'],
          ['⌘ D  ⌫', 'Duplicate, delete'],
        ].map(([k, v]) => (
          <div key={k} className="insp-shortcut">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
