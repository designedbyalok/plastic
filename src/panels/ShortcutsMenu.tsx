/** Keyboard shortcuts, behind a button at the bottom of the tool rail. */
import { Keyboard } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useEditor } from '../editor/store.ts';

const GROUPS: readonly { title: string; items: readonly [string, readonly string[]][] }[] = [
  {
    title: 'Tools',
    items: [
      ['Select', ['V']],
      ['Frame', ['F']],
      ['Rectangle', ['R']],
      ['Ellipse', ['O']],
      ['Line', ['⇧', 'L']],
      ['Pen', ['P']],
      ['Container', ['C']],
      ['Text', ['T']],
      ['Heading', ['H']],
      ['Button', ['B']],
      ['Input', ['I']],
      ['Labeled field', ['L']],
      ['Pan', ['Space']],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Undo', ['⌘', 'Z']],
      ['Redo', ['⇧', '⌘', 'Z']],
      ['Duplicate', ['⌘', 'D']],
      ['Delete', ['⌫']],
      ['Add flex / wrap', ['⇧', 'A']],
      ['Clip content', ['⌥', 'C']],
      ['Nudge', ['←', '→', '↑', '↓']],
      ['Nudge 10px', ['⇧', 'Arrows']],
    ],
  },
  {
    title: 'Selection',
    items: [
      ['Edit text', ['Double-click']],
      ['Add to selection', ['⇧', 'Click']],
      ['Select child', ['Enter']],
      ['Select parent', ['Esc']],
    ],
  },
  {
    title: 'Vectors',
    items: [
      ['Edit points', ['Double-click']],
      ['Corner ↔ smooth', ['Double-click point']],
      ['Add point', ['Click segment']],
      ['Bend segment', ['⌘', 'Drag']],
      ['Break handle', ['⌥', 'Drag']],
      ['Snap to 45° / square', ['⇧', 'Drag']],
      ['Draw from center', ['⌥', 'Drag']],
      ['Union / Subtract', ['⌥', '⇧', 'U / S']],
      ['Intersect / Exclude', ['⌥', '⇧', 'I / X']],
      ['Flatten', ['⌘', 'E']],
      ['Outline stroke', ['⌥', '⌘', 'O']],
      ['Finish / done', ['Esc']],
    ],
  },
  {
    title: 'View',
    items: [
      ['Zoom in / out', ['⌘', '+ / −']],
      ['Zoom to 100%', ['⇧', '0']],
      ['Zoom to fit', ['⇧', '1']],
      ['Zoom to selection', ['⇧', '2']],
      ['Show / hide panel', ['⌘', '\\']],
      ['Save now', ['⌘', 'S']],
    ],
  },
];

export function ShortcutsMenu() {
  const open = useEditor((s) => s.shortcutsOpen);
  const setOpen = useEditor.getState().setShortcutsOpen;
  const ref = useRef<HTMLDivElement>(null);
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

  return (
    <div className="rail-menu-anchor" ref={ref}>
      <button
        type="button"
        className={`rail-button${open ? ' is-active' : ''}`}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      >
        <Keyboard size={17} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="shortcuts-popover" role="dialog" aria-label="Keyboard shortcuts">
          {GROUPS.map((group) => (
            <section key={group.title} className="shortcuts-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map(([label, keys]) => (
                  <div key={label} className="shortcuts-row">
                    <dt>{label}</dt>
                    <dd>
                      {keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
