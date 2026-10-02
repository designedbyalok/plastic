import { useEffect, useReducer } from 'react';
import { getElement, nodesWithClass } from '../../document/tree';
import type { ElementNode } from '../../document/types';
import { useEditor } from '../../editor/store';
import { AttributesSection, BehaviorSection, ContentSection, ElementHeader, SemanticsSection, TableSection } from './ElementSections';
import { AppearanceSection, ChildLayoutSection, CssSection, LayoutSection, PositionSection, SizeSection, SpacingSection, TypographySection } from './StyleSections';

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

  return (
    <aside className="panel inspector" aria-label="Inspector">
      {!elements.length ? (
        <EmptyInspector />
      ) : (
        <div key={ids.join(',')}>
          {single ? <ElementHeader el={single} /> : <div className="element-header"><span className="element-kind-label">{elements.length} elements</span><span className="muted">Style changes apply to each element's class.</span></div>}
          {single && <SemanticsSection el={single} />}
          {single && <ContentSection el={single} />}
          {single && <BehaviorSection el={single} />}
          {single && <TableSection el={single} />}
          <PositionSection ids={ids} />
          <LayoutSection ids={ids} />
          <ChildLayoutSection ids={ids} />
          <SizeSection ids={ids} />
          <SpacingSection ids={ids} />
          <AppearanceSection ids={ids} />
          <TypographySection ids={ids} />
          {single && <CssSection el={single} />}
          {single && <AttributesSection el={single} />}
          {single && single.classes[0] && nodesWithClass(doc, single.classes[0]).length > 1 && (
            <p className="muted inspector-note">Editing .{single.classes[0]} changes every element that uses it.</p>
          )}
        </div>
      )}
    </aside>
  );
}

function EmptyInspector() {
  const doc = useEditor((s) => s.doc);
  const elements = Object.values(doc.nodes).filter((n) => n.kind === 'element').length;
  return (
    <div className="empty-inspector">
      <div className="panel-title">{doc.title}</div>
      <p className="muted">
        {doc.roots.length} artboard{doc.roots.length === 1 ? '' : 's'} · {elements} elements · {Object.keys(doc.styles.rules).length} classes
      </p>
      <dl className="shortcuts">
        {[
          ['F', 'Draw a frame'],
          ['H T B I L', 'Heading, text, button, input, field'],
          ['Click', 'Select · Shift-click adds'],
          ['Double-click', 'Edit text'],
          ['⇧A', 'Wrap selection in a stack'],
          ['Enter / Esc', 'Into child / up to parent'],
          ['Space-drag', 'Pan · ⌘-scroll / pinch zooms'],
          ['⇧1 ⇧2 ⇧0', 'Fit all, fit selection, 100%'],
          ['⌘Z ⇧⌘Z ⌘D', 'Undo, redo, duplicate'],
        ].map(([k, v]) => (
          <div key={k} className="shortcut">
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
