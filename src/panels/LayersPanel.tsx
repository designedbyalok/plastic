import { ChevronDown, ChevronRight, Diamond, EyeOff, File, Lock, PanelLeft, Plus, X } from 'lucide-react';
import { isHidden, isLocked, toggleHidden, toggleLocked } from '../editor/layerActions.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { setName, setTitle } from '../document/ops.ts';
import { addPage, nextPageName, removePage, renamePage } from '../document/pages.ts';
import { ancestorIds, elementChildren, getElement } from '../document/tree.ts';
import type { NodeId, Page } from '../document/types.ts';
import { kindLabel, layerName } from '../elements/registry.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { moveLayersTo, zoomToLayer } from '../editor/commands.ts';
import { iconFor } from './icons.tsx';
import { ThemePanel } from './ThemePanel.tsx';
import { PanelResizer } from './PanelResizer.tsx';
import { FileMenu } from './FileMenu.tsx';
import { canMoveLayers, type LayerPlacement } from '../document/layerMove.ts';
import { elementSpec } from '../elements/registry.ts';
import { ScrollArea } from './ui/ScrollArea.tsx';

export function LayersPanel() {
  const title = useEditor((s) => s.doc.title);
  const layersOpen = useEditor((s) => s.layersOpen);
  const tab = useEditor((s) => s.leftTab);
  const width = useEditor((s) => s.layersWidth);
  if (!layersOpen) return <CollapsedFileHeader />;
  return (
    <aside className="panel layers-panel" aria-label="File" style={{ width }}>
      <PanelResizer />
      <header className="file-header">
        <FileMenu />
        <input
          className="file-title"
          aria-label="File name"
          value={title}
          spellCheck={false}
          onChange={(e) =>
            useEditor.getState().apply('Rename file', (d) => setTitle(d, e.target.value), { coalesce: 'title' })
          }
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
        />
        <button
          type="button"
          className="icon-button"
          title="Hide Panel  ⌘\\"
          aria-label="Hide Panel"
          onClick={() => useEditor.getState().setLayersOpen(false)}
        >
          <PanelLeft size={15} strokeWidth={1.5} />
        </button>
      </header>
      <div className="left-tabs">
        <div className="insp-segmented" role="tablist" aria-label="Panel">
          {(['design', 'theme'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`insp-segment${tab === t ? ' is-active' : ''}`}
              onClick={() => useEditor.getState().setLeftTab(t)}
            >
              {t === 'design' ? 'Design' : 'Theme'}
            </button>
          ))}
        </div>
      </div>
      {tab === 'design' ? (
        <>
          <PagesSection />
          <div className="left-divider" />
          <LayersTree />
        </>
      ) : (
        <ThemePanel />
      )}
    </aside>
  );
}

/** With the panel hidden: a floating pill with the file, and the toggle to bring the panel back. */
function CollapsedFileHeader() {
  const title = useEditor((s) => s.doc.title);
  return (
    <div className="collapsed-header">
      <FileMenu />
      <span className="collapsed-title" title={title}>
        {title}
      </span>
      <button
        type="button"
        className="icon-button"
        title="Show Panel  ⌘\\"
        aria-label="Show Panel"
        onClick={() => useEditor.getState().setLayersOpen(true)}
      >
        <PanelLeft size={15} strokeWidth={1.5} />
      </button>
    </div>
  );
}

function PagesSection() {
  const pages = useEditor((s) => s.doc.pages);
  const [open, setOpen] = useState(true);
  const add = () => {
    const store = useEditor.getState();
    let file = '';
    store.apply('Add Page', (d) => {
      const made = addPage(d, nextPageName(d), store.activePage);
      file = made.file;
      return made.doc;
    });
    useEditor.getState().setActivePage(file);
  };
  return (
    <section className="pages" aria-label="Pages">
      <div className="left-section-header">
        <button type="button" className="left-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
          Pages
        </button>
        <button type="button" className="icon-button" title="Add Page" aria-label="Add Page" onClick={add}>
          <Plus size={13} strokeWidth={1.5} />
        </button>
      </div>
      {open && (
        <ScrollArea className="pages-list" viewportClassName="pages-list-content" role="listbox" aria-label="Pages">
          {pages.map((p) => (
            <PageRow key={p.file} page={p} canDelete={pages.length > 1} />
          ))}
        </ScrollArea>
      )}
    </section>
  );
}

function PageRow({ page, canDelete }: { page: Page; canDelete: boolean }) {
  const active = useEditor((s) => s.activePage === page.file);
  const [renaming, setRenaming] = useState(false);
  const store = useEditor.getState;
  return (
    <div
      role="option"
      aria-selected={active}
      className={`page-row${active ? ' is-selected' : ''}`}
      title={`${page.name} — ${page.file}`}
      onClick={() => store().setActivePage(page.file)}
      onDoubleClick={() => setRenaming(true)}
    >
      <File size={12} strokeWidth={1.75} className="layer-icon" />
      {renaming ? (
        <input
          className="layer-rename"
          autoFocus
          defaultValue={page.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            store().apply('Rename page', (d) => renamePage(d, page.file, e.target.value));
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span className="layer-name">{page.name}</span>
      )}
      <span className="layer-tag">{page.file}</span>
      {canDelete && !renaming && (
        <button
          type="button"
          className="icon-button page-delete"
          title="Delete Page"
          aria-label={`Delete ${page.name}`}
          onClick={(e) => {
            e.stopPropagation();
            store().apply('Delete Page', (d) => removePage(d, page.file));
          }}
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

let draggedLayers: readonly NodeId[] = [];

function LayersTree() {
  const roots = useEditor(activeRoots);
  // Document edits may recreate an unchanged selection array. Anchor only when its ids change.
  const selectionKey = useEditor((s) => JSON.stringify(s.selection));
  const page = useEditor((s) => s.activePage);
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const store = useEditor.getState();
    const selection = store.selection;
    for (const id of selection) {
      for (const parent of ancestorIds(store.doc, id)) {
        if (store.collapsed[parent]) store.setCollapsed(parent, false);
      }
    }
    // Expansion renders before measuring. Only selection/page changes trigger anchoring,
    // so manual scrolling and collapsing remain under the user's control.
    const raf = requestAnimationFrame(() => {
      const scroller = viewport.current;
      const id = selection.at(-1);
      if (!scroller || !id) return;
      const row = Array.from(scroller.querySelectorAll<HTMLElement>('[data-layer-id]'))
        .find((el) => el.dataset.layerId === id);
      if (!row) return;
      const bounds = scroller.getBoundingClientRect();
      const target = row.getBoundingClientRect();
      const inset = Math.min(28, bounds.height / 4);
      const delta = target.top < bounds.top + inset ? target.top - bounds.top - inset
        : target.bottom > bounds.bottom - inset ? target.bottom - bounds.bottom + inset : 0;
      if (delta) scroller.scrollTo({ top: scroller.scrollTop + delta,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectionKey, page]);
  return (
    <>
      <div className="layers-heading">Layers</div>
      <ScrollArea className="layers-tree" viewportClassName="layers-tree-content" viewportRef={viewport} role="tree">
        {roots.map((id) => (
          <LayerRow key={id} id={id} depth={0} />
        ))}
        {!roots.length && <p className="layers-empty">No layers on this page yet.</p>}
      </ScrollArea>
    </>
  );
}

function LayerRow({ id, depth }: { id: NodeId; depth: number }) {
  const doc = useEditor((s) => s.doc);
  const selected = useEditor((s) => s.selection.includes(id));
  const hovered = useEditor((s) => s.hoverId === id);
  const collapsed = useEditor((s) => !!s.collapsed[id]);
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<LayerPlacement | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => () => clearTimeout(expandTimer.current), []);
  const el = getElement(doc, id);
  if (!el) return null;

  const children = elementChildren(doc, el);
  useEffect(() => {
    if (!drop) return;
    const clear = () => { setDrop(null); clearTimeout(expandTimer.current); };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => { window.removeEventListener('dragend', clear); window.removeEventListener('drop', clear); };
  }, [drop]);
  const store = useEditor.getState;
  const rule = el.classes[0] ? doc.styles.rules[el.classes[0]] : undefined;
  const isFlex = rule?.display?.includes('flex');
  const Icon = iconFor(el, isFlex ? (rule?.['flex-direction'] ?? 'row') : undefined);
  const name = layerName(doc, id);
  const kind = kindLabel(el);
  const placementAt = (fraction: number): LayerPlacement => {
    if (!elementSpec(el.tag).acceptsChildren) return fraction < .5 ? 'before' : 'after';
    return fraction < .2 ? 'before' : fraction > .8 ? 'after' : 'inside';
  };

  return (
    <>
      <div
        role="treeitem"
        draggable={!renaming}
        onDragStart={(e) => {
          e.stopPropagation();
          const state = store();
          draggedLayers = state.selection.includes(id) ? state.selection : [id];
          e.dataTransfer.setData('application/x-plastic-layers', JSON.stringify(draggedLayers));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!draggedLayers.length) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          const fraction = (e.clientY - bounds.top) / bounds.height;
          const placement = placementAt(fraction);
          if (!canMoveLayers(store().doc, draggedLayers, id, placement)) {
            setDrop(null);
            clearTimeout(expandTimer.current);
            return;
          }
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (drop !== placement) {
            clearTimeout(expandTimer.current);
            setDrop(placement);
            if (placement === 'inside' && collapsed) expandTimer.current = setTimeout(() => store().setCollapsed(id, false), 550);
          }
          const viewport = e.currentTarget.closest('.ui-scroll-viewport');
          if (viewport) {
            const area = viewport.getBoundingClientRect();
            if (e.clientY < area.top + 32) viewport.scrollTop -= 8;
            else if (e.clientY > area.bottom - 32) viewport.scrollTop += 8;
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDrop(null); clearTimeout(expandTimer.current);
        }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation();
          clearTimeout(expandTimer.current);
          const bounds = e.currentTarget.getBoundingClientRect();
          const fraction = (e.clientY - bounds.top) / bounds.height;
          const placement = placementAt(fraction);
          if (draggedLayers.length && canMoveLayers(store().doc, draggedLayers, id, placement)) {
            const ids = draggedLayers;
            moveLayersTo(ids, id, placement);
            if (placement === 'inside') store().setCollapsed(id, false);
          }
          draggedLayers = []; setDrop(null);
        }}
        onDragEnd={() => { draggedLayers = []; setDrop(null); clearTimeout(expandTimer.current); }}
        data-layer-id={id}
        aria-selected={selected}
        aria-expanded={children.length ? !collapsed : undefined}
        className={`layer-row${isHidden(doc, id) ? ' layer-is-hidden' : ''}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${drop ? ` drop-${drop}` : ''}`}
        style={{ paddingLeft: 4 + depth * 12 }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          if (e.shiftKey || e.metaKey) store().toggleSelected(id);
          else if (!store().selection.includes(id)) store().select([id]);
        }}
        onClick={(e) => {
          if (!e.shiftKey && !e.metaKey && store().selection.length > 1 && !(e.target as HTMLElement).closest('button, input')) store().select([id]);
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
        {/* The icon zooms the canvas to this layer (the row press has already selected it). */}
        <button
          type="button"
          className="layer-icon-button"
          tabIndex={-1}
          title="Zoom to layer"
          aria-label={`Zoom to ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            zoomToLayer(id);
          }}
        >
          {doc.components?.definitions[id] || doc.components?.instances[id] ? (
            <Diamond
              size={12}
              strokeWidth={doc.components.definitions[id] ? 2.5 : 1.5}
              className="layer-icon"
              aria-label={doc.components.definitions[id] ? 'Main Component' : 'Component Instance'}
            />
          ) : (
            <Icon size={12} strokeWidth={1.75} className="layer-icon" />
          )}
        </button>
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
        {isLocked(doc, id) && (
          <button type="button" className="lp-row-state" title="Locked on the canvas. Click to unlock." aria-label="Unlock layer"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleLocked([id]); }}>
            <Lock size={12} strokeWidth={1.75} />
          </button>
        )}
        {isHidden(doc, id) && (
          <button type="button" className="lp-row-state" title="Hidden. Click to show." aria-label="Show layer"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleHidden([id]); }}>
            <EyeOff size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>
      {!collapsed && children.map((child) => <LayerRow key={child.id} id={child.id} depth={depth + 1} />)}
    </>
  );
}
