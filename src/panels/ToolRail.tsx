/**
 * Vertical tool rail. Primary tools are one click; the semantic elements (button, input,
 * field, select…) live in a single Insert menu so the rail stays short.
 */
import { CirclePlus, Frame, Hand, Heading, Image, MousePointer2, PenTool, Square, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { INSERTABLES, insertable } from '../elements/insertables.ts';
import { useEditor, type Tool } from '../editor/store.ts';
import { INSERT_ICONS } from './icons.tsx';
import { ShortcutsMenu } from './ShortcutsMenu.tsx';

/** Elements that get their own rail button; everything else is in the Insert menu. */
const RAIL_ITEMS = new Set(['container', 'text', 'heading', 'image']);

function sameTool(a: Tool, b: Tool): boolean {
  return a.kind === b.kind && (a.kind !== 'insert' || (b.kind === 'insert' && a.itemId === b.itemId));
}

function RailButton({ tool, label, shortcut, children }: { tool: Tool; label: string; shortcut?: string; children: ReactNode }) {
  const active = useEditor((s) => sameTool(s.tool, tool));
  return (
    <button
      type="button"
      className={`rail-button${active ? ' is-active' : ''}`}
      title={shortcut ? `${label}  ${shortcut}` : label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => useEditor.getState().setTool(active ? { kind: 'select' } : tool)}
    >
      {children}
    </button>
  );
}

function insertTool(id: string): Tool {
  return { kind: 'insert', itemId: id };
}

function InsertMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tool = useEditor((s) => s.tool);
  const activeMenuItem = tool.kind === 'insert' && !RAIL_ITEMS.has(tool.itemId) ? insertable(tool.itemId) : undefined;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const ActiveIcon = activeMenuItem ? INSERT_ICONS[activeMenuItem.id] : undefined;
  return (
    <div className="rail-menu-anchor" ref={ref}>
      <button
        type="button"
        className={`rail-button${open || activeMenuItem ? ' is-active' : ''}`}
        title={activeMenuItem ? `Insert ${activeMenuItem.label}` : 'Insert element'}
        aria-label="Insert element"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {ActiveIcon ? <ActiveIcon size={18} strokeWidth={1.5} /> : <CirclePlus size={18} strokeWidth={1.5} />}
      </button>
      {open && (
        <div className="rail-menu" role="menu">
          <div className="rail-menu-title">Insert element</div>
          {INSERTABLES.filter((i) => !RAIL_ITEMS.has(i.id)).map((item) => {
            const Icon = INSERT_ICONS[item.id];
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="rail-menu-item"
                onClick={() => {
                  useEditor.getState().setTool(insertTool(item.id));
                  setOpen(false);
                }}
              >
                {Icon && <Icon size={14} strokeWidth={1.5} />}
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut.toUpperCase()}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ToolRail() {
  const layersOpen = useEditor((s) => s.layersOpen);
  return (
    // With the side panel hidden, the rail floats over the canvas.
    <nav className={`rail${layersOpen ? '' : ' is-floating'}`} aria-label="Tools">
      <div className="rail-group">
        <RailButton tool={{ kind: 'select' }} label="Select" shortcut="V">
          <MousePointer2 size={18} strokeWidth={1.5} />
        </RailButton>
        <RailButton tool={{ kind: 'hand' }} label="Hand (or hold Space)">
          <Hand size={18} strokeWidth={1.5} />
        </RailButton>
        <div className="rail-divider" />
        <RailButton tool={{ kind: 'frame' }} label="Frame" shortcut="F">
          <Frame size={18} strokeWidth={1.5} />
        </RailButton>
        <RailButton tool={{ kind: 'pen' }} label="Pen" shortcut="P">
          <PenTool size={18} strokeWidth={1.5} />
        </RailButton>
        <RailButton tool={insertTool('container')} label="Container" shortcut="C">
          <Square size={16} strokeWidth={1.5} />
        </RailButton>
        <RailButton tool={insertTool('text')} label="Text" shortcut="T">
          <Type size={18} strokeWidth={1.5} />
        </RailButton>
        <RailButton tool={insertTool('heading')} label="Heading" shortcut="H">
          <Heading size={18} strokeWidth={1.5} />
        </RailButton>
        <div className="rail-divider" />
        <RailButton tool={insertTool('image')} label="Image">
          <Image size={18} strokeWidth={1.5} />
        </RailButton>
        <InsertMenu />
      </div>
      <div className="rail-group">
        {!layersOpen && <div className="rail-divider" />}
        <ShortcutsMenu />
      </div>
    </nav>
  );
}
