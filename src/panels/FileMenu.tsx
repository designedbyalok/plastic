/**
 * The file menu behind the Plastic mark (top left of the editor): back to the dashboard, view
 * toggles and file actions. Only things Plastic can actually do are listed.
 */
import { Check, Layers3 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fileHref, navigate } from '../app/router';
import { duplicateOpenProject } from '../editor/persistence';
import { useEditor } from '../editor/store';

export function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const layersOpen = useEditor((s) => s.layersOpen);
  const codeOpen = useEditor((s) => s.codeOpen);
  const store = useEditor.getState;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="file-menu-anchor" ref={ref}>
      <button
        type="button"
        className={`file-mark${open ? ' is-active' : ''}`}
        title="Menu"
        aria-label="Menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers3 size={15} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="file-menu" role="menu" aria-label="File">
          <Item onClick={run(() => navigate('/'))} keys="⇧⌘D">
            Back to dashboard
          </Item>
          <div className="file-menu-divider" role="separator" />
          <Item checked={layersOpen} onClick={run(() => store().setLayersOpen(!layersOpen))} keys="⌘\">
            Show layers panel
          </Item>
          <Item checked={codeOpen} onClick={run(() => store().setCodeOpen(!codeOpen))}>
            Show code
          </Item>
          <div className="file-menu-divider" role="separator" />
          <Item onClick={run(() => store().setAgentsOpen(true))}>Connect agents…</Item>
          <Item onClick={run(() => store().setShortcutsOpen(true))}>Keyboard shortcuts…</Item>
          <div className="file-menu-divider" role="separator" />
          <Item
            onClick={run(() => {
              void duplicateOpenProject().then((id) => id && navigate(fileHref(id)));
            })}
          >
            Duplicate file
          </Item>
        </div>
      )}
    </div>
  );
}

function Item({ children, onClick, keys, checked }: { children: ReactNode; onClick(): void; keys?: string; checked?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} className="file-menu-item" onClick={onClick}>
      <span className="file-menu-check">{checked && <Check size={13} strokeWidth={2} />}</span>
      <span className="file-menu-label">{children}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
}
