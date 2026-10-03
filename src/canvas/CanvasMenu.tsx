/**
 * The canvas's right-click menu: clipboard, structure, layer order, visibility and locking for
 * the selection. Every item has the same keyboard shortcut in the editor.
 */
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { addFlexOrWrap, duplicateSelection } from '../editor/commands.ts';
import { copySelectionToClipboard, pasteFromSystemClipboard } from '../editor/clipboard.ts';
import { copyFrameContext, copyFrameLink } from '../editor/frameLinks.ts';
import {
  copyAs, copyStyles, frameSelection, hasCopiedStyles, isHidden, isLocked, pasteStyles, reorderSelection,
  toggleHidden, toggleLocked, ungroupSelection,
} from '../editor/layerActions.ts';
import { useEditor } from '../editor/store.ts';
import { getElement } from '../document/tree.ts';
import { Menu, MenuContent } from '../panels/ui/Menu.tsx';

export type CanvasMenuAt = { x: number; y: number } | null;

function Item({ label, kbd, run, disabled }: { label: ReactNode; kbd?: string; run(): void; disabled?: boolean }) {
  return (
    <Menu.Item className="insp-menu-item" disabled={disabled} onSelect={run}>
      <span>{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </Menu.Item>
  );
}

const Divider = () => <Menu.Separator className="insp-menu-divider" />;

export function CanvasMenu({ at, onClose }: { at: CanvasMenuAt; onClose(): void }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection).filter((id) => getElement(doc, id));
  const primary = selection.at(-1);
  const some = selection.length > 0;
  const hasChildren = selection.some((id) => getElement(doc, id)!.children.some((c) => getElement(doc, c)));
  const hidden = primary ? isHidden(doc, primary) : false;
  const locked = primary ? isLocked(doc, primary) : false;
  // Read when the menu opens (they live outside the store).
  const canPasteStyles = some && hasCopiedStyles();

  return (
    <Menu.Root open={!!at} onOpenChange={(open) => !open && onClose()} modal={false}>
      <Menu.Trigger asChild>
        <span aria-hidden="true" className="canvas-menu-anchor" style={at ? { left: at.x, top: at.y } : undefined} />
      </Menu.Trigger>
      {at && (
        <MenuContent align="start" side="bottom" sideOffset={2} aria-label="Layer actions" className="canvas-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
          <Item label="Copy" kbd="⌘C" disabled={!some} run={() => void copySelectionToClipboard()} />
          <Item label="Copy link" kbd="⌘L" disabled={!some} run={() => void copyFrameLink(primary)} />
          <Menu.Sub>
            <Menu.SubTrigger className="insp-menu-item" disabled={!some}>
              <span>Copy as</span>
              <ChevronRight size={12} strokeWidth={1.75} aria-hidden="true" />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className="insp-menu plastic-menu-portal canvas-menu" data-plastic-menu="" sideOffset={4} alignOffset={-4} collisionPadding={8}>
                <Item label="Copy as HTML" run={() => void copyAs('html')} />
                <Item label="Copy as CSS" run={() => void copyAs('css')} />
                <Item label="Copy as PNG" run={() => void copyAs('png')} />
                <Divider />
                <Item label="Copy context for AI" run={() => primary && void copyFrameContext(primary)} />
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Item label="Paste" kbd="⌘V" run={() => void pasteFromSystemClipboard('normal')} />
          <Item label="Paste on top" kbd="⇧⌘V" run={() => void pasteFromSystemClipboard('over')} />
          <Item label="Paste to replace" kbd="⇧⌘R" disabled={!some} run={() => void pasteFromSystemClipboard('replace')} />
          <Item label="Duplicate" kbd="⌘D" disabled={!some} run={duplicateSelection} />
          <Divider />
          <Item label="Copy styles" kbd="⌥⌘C" disabled={!some} run={copyStyles} />
          <Item label="Paste styles" kbd="⌥⌘V" disabled={!canPasteStyles} run={pasteStyles} />
          <Divider />
          <Item label="Frame selection" kbd="⇧F" disabled={!some} run={frameSelection} />
          <Item label="Add flex layout" kbd="⇧A" disabled={!some} run={addFlexOrWrap} />
          <Item label="Ungroup" kbd="⇧⌘G" disabled={!hasChildren} run={ungroupSelection} />
          <Divider />
          <Item label="Bring to front" kbd="]" disabled={!some} run={() => reorderSelection('front')} />
          <Item label="Send to back" kbd="[" disabled={!some} run={() => reorderSelection('back')} />
          <Item label="Move forward" kbd="⌘]" disabled={!some} run={() => reorderSelection('forward')} />
          <Item label="Move backward" kbd="⌘[" disabled={!some} run={() => reorderSelection('backward')} />
          <Divider />
          <Item label={hidden ? 'Show' : 'Hide'} kbd="⇧⌘H" disabled={!some} run={toggleHidden} />
          <Item label={locked ? 'Unlock' : 'Lock'} kbd="⇧⌘L" disabled={!some} run={toggleLocked} />
        </MenuContent>
      )}
    </Menu.Root>
  );
}
