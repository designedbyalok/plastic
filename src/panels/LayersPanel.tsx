import { ChevronDown, ChevronRight, File, PanelLeft, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { setName, setTitle } from '../document/ops';
import { addPage, nextPageName, removePage, renamePage } from '../document/pages';
import { elementChildren, getElement } from '../document/tree';
import type { NodeId, Page } from '../document/types';
import { kindLabel, layerName } from '../elements/registry';
import { activeRoots, useEditor } from '../editor/store';
import { iconFor } from './icons';
import { ThemePanel } from './ThemePanel';
import { PanelResizer } from './PanelResizer';
import { FileMenu } from './FileMenu';

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
          onChange={(e) => useEditor.getState().apply('Rename file', (d) => setTitle(d, e.target.value), { coalesce: 'title' })}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
        />
        <button type="button" className="icon-button" title="Hide panel  ⌘\\" aria-label="Hide panel" onClick={() => useEditor.getState().setLayersOpen(false)}>
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
      <button type="button" className="icon-button" title="Show panel  ⌘\\" aria-label="Show panel" onClick={() => useEditor.getState().setLayersOpen(true)}>
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
    store.apply('Add page', (d) => {
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
        <button type="button" className="icon-button" title="Add page" aria-label="Add page" onClick={add}>
          <Plus size={13} strokeWidth={1.5} />
        </button>
      </div>
      {open && (
        <div className="pages-list" role="listbox" aria-label="Pages">
          {pages.map((p) => (
            <PageRow key={p.file} page={p} canDelete={pages.length > 1} />
          ))}
        </div>
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
          title="Delete page"
          aria-label={`Delete ${page.name}`}
          onClick={(e) => {
            e.stopPropagation();
            store().apply('Delete page', (d) => removePage(d, page.file));
          }}
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

function LayersTree() {
  const roots = useEditor(activeRoots);
  return (
    <>
      <div className="layers-heading">Layers</div>
      <div className="layers-tree" role="tree">
        {roots.map((id) => (
          <LayerRow key={id} id={id} depth={0} />
        ))}
        {!roots.length && <p className="layers-empty">No layers on this page yet.</p>}
      </div>
    </>
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
