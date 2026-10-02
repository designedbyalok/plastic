/** A small popover menu for the home screen (file and folder actions, the account menu). */
import { useEffect, useRef, type ReactNode } from 'react';

export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);
  return ref;
}

export function MenuItem({ icon, children, onSelect, danger, disabled }: { icon?: ReactNode; children: ReactNode; onSelect(): void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`home-menu-item${danger ? ' is-danger' : ''}`}
      onClick={(e) => {
        // Menus can sit inside a card's link: don't let the click follow it.
        e.preventDefault();
        e.stopPropagation();
        onSelect();
      }}
    >
      {icon && <span className="home-menu-icon">{icon}</span>}
      <span className="home-menu-label">{children}</span>
    </button>
  );
}

export function MenuDivider() {
  return <div className="home-menu-divider" role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="home-menu-heading">{children}</div>;
}
