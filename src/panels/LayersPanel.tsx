import { ChevronDown, ChevronRight, Layers3, PanelLeft } from 'lucide-react';
import { useState } from 'react';
import { setName, setTitle } from '../document/ops';
import { linkClick } from '../app/router';
import { elementChildren, getElement } from '../document/tree';
import type { NodeId } from '../document/types';
import { kindLabel, layerName } from '../elements/registry';
import { useEditor } from '../editor/store';
import { iconFor } from './icons';

export function LayersPanel() {
  const roots = useEditor((s) => s.doc.roots);
  const title = useEditor((s) => s.doc.title);
  const layersOpen = useEditor((s) => s.layersOpen);
  if (!layersOpen) return null;
  return (
    <aside className="panel layers-panel" aria-label="Layers">
      <header className="file-header">
        <a className="file-mark" href="/" onClick={linkClick} title="All files" aria-label="All files">
          <Layers3 size={15} strokeWidth={1.75} />
        </a>
        <input
          className="file-title"
          aria-label="File name"
          value={title}
          spellCheck={false}
          onChange={(e) => useEditor.getState().apply('Rename file', (d) => setTitle(d, e.target.value), { coalesce: 'title' })}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
        />
        <button type="button" className="icon-button" title="Hide layers" aria-label="Hide layers" onClick={() => useEditor.getState().setLayersOpen(false)}>
          <PanelLeft size={15} strokeWidth={1.5} />
        </button>
      </header>
      <div className="layers-heading">Layers</div>
      <div className="layers-tree" role="tree">
        {roots.map((id) => (
          <LayerRow key={id} id={id} depth={0} />
        ))}
      </div>
    </aside>
  );
}

function LayerRow({ id, depth }: { id: NodeId; depth: number }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selection.includes(id));
  const hovered = useEditor((s) => s.hoverId === id);
  const collapsed = useEditor((s) => !!s.collapsed[id]);
  const [renaming, setRenaming] = useState(false);
  const el = getElement(doc, id);
  if (!el) return null;

  const children = elementChildren(doc, el);
  const store = useEditor.getState;
  const rule = el.classes[0] ? doc.styles.rules[el.classes[0]] : undefined;
  const isFlex = rule?.display?.includes('flex');
  const Icon = iconFor(el, isFlex ? (rule?.['flex-direction'] ?? 'row') : undefined);
  const name = layerName(doc, id);
  const kind = kindLabel(el);

  return (
    <>
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={children.length ? !collapsed : undefined}
        className={`layer-row${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (e.shiftKey || e.metaKey) store().toggleSelected(id);
          else store().select([id]);
        }}
        onPointerEnter={() => store().setHover(id)}
        onPointerLeave={() => store().setHover(null)}
        onDoubleClick={() => setRenaming(true)}
        title={`${kind} <${el.tag}>${el.classes.length ? ' .' + el.classes.join('.') : ''}`}
      >
        <button
          type="button"
          className="layer-toggle"
          tabIndex={-1}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          style={{ visibility: children.length ? 'visible' : 'hidden' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => store().setCollapsed(id, !collapsed)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <Icon size={12} strokeWidth={1.75} className="layer-icon" />
        {renaming ? (
          <input
            className="layer-rename"
            autoFocus
            defaultValue={doc.names[id] ?? name}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              store().apply('Rename layer', (d) => setName(d, id, e.target.value || null));
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="layer-name">{name}</span>
        )}
        <span className="layer-tag">&lt;{el.tag}&gt;</span>
      </div>
      {!collapsed && children.map((child) => <LayerRow key={child.id} id={child.id} depth={depth + 1} />)}
    </>
  );
}
