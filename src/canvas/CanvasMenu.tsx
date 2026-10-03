/**
 * The canvas's right-click menu: clipboard, structure, layer order, visibility and locking for
 * the selection. Every item has the same keyboard shortcut in the editor.
 */
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { addFlexOrWrap, cycleArtboard, duplicateSelection, toggleUi } from '../editor/commands.ts';
import { toScreen } from './dom.ts';
import { screenToWorld } from './coords.ts';
import { openCursorChat } from '../editor/presence.ts';
import { copySelectionToClipboard, pasteFromSystemClipboard } from '../editor/clipboard.ts';
import { copyFrameContext, copyFrameLink } from '../editor/frameLinks.ts';
import {
  copyAs, copyStyles, frameSelection, hasCopiedStyles, isHidden, isLocked, pasteStyles, reorderSelection,
  toggleHidden, toggleLocked, ungroupSelection,
} from '../editor/layerActions.ts';
import { activeRoots, useEditor } from '../editor/store.ts';
import { getElement, isRoot } from '../document/tree.ts';
import { useAsThumbnail } from '../editor/thumbnail.ts';
import { notify } from './gestureStore.ts';
import { Menu, MenuContent } from '../panels/ui/Menu.tsx';

/** Where the menu opened (client point) and on what: layers, or empty canvas. */
export type CanvasMenuAt = { x: number; y: number; target: 'layers' | 'canvas' } | null;

function Item({ label, kbd, run, disabled }: { label: ReactNode; kbd?: string; run(): void; disabled?: boolean }) {
  return (
    <Menu.Item className="insp-menu-item" disabled={disabled} onSelect={run}>
      <span>{label}</span>
      {kbd && <kbd>{kbd}</kbd>}
    </Menu.Item>
  );
}

const Divider = () => <Menu.Separator className="insp-menu-divider" />;

/** Open cursor chat where the menu was opened, after the menu has closed and returned focus. */
function chatAt(at: { x: number; y: number }) {
  const { viewport, activePage } = useEditor.getState();
  const point = { ...screenToWorld(toScreen(at.x, at.y), viewport), page: activePage };
  setTimeout(() => openCursorChat(point));
}

export function CanvasMenu({ at, onClose }: { at: CanvasMenuAt; onClose(): void }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection).filter((id) => getElement(doc, id));
  const primary = selection.at(-1);
  const some = selection.length > 0;
  const hasChildren = selection.some((id) => getElement(doc, id)!.children.some((c) => getElement(doc, c)));
  const hidden = primary ? isHidden(doc, primary) : false;
  const locked = primary ? isLocked(doc, primary) : false;
  // Read when the menu opens (they live outside the store).
  const artboards = useEditor(activeRoots).length > 0;
  const readOnly = useEditor((s) => s.readOnly);
  // A single outermost frame can become the file's thumbnail.
  const frame = selection.length === 1 && primary && isRoot(doc, primary) ? primary : null;
  const thumbnail = doc.thumbnail?.frame;
  const canPasteStyles = some && hasCopiedStyles() && !readOnly;

  return (
    <Menu.Root open={!!at} onOpenChange={(open) => !open && onClose()} modal={false}>
      <Menu.Trigger asChild>
        <span aria-hidden="true" className="canvas-menu-anchor" style={at ? { left: at.x, top: at.y } : undefined} />
      </Menu.Trigger>
      {at?.target === 'canvas' && (
        <MenuContent align="start" side="bottom" sideOffset={2} aria-label="Canvas actions" className="canvas-menu" onCloseAutoFocus={(e) => e.preventDefault()}>
          <Item label="Paste" kbd="⌘V" disabled={readOnly} run={() => void pasteFromSystemClipboard('normal', toScreen(at.x, at.y))} />
          <Divider />
          <Item label="Next artboard" kbd="N" disabled={!artboards} run={() => cycleArtboard(1)} />
          <Item label="Previous artboard" kbd="⇧N" disabled={!artboards} run={() => cycleArtboard(-1)} />
          <Item label="Cursor chat" kbd="/" run={() => chatAt(at)} />
          <Divider />
          <Item label="Hide UI" kbd="." run={toggleUi} />
        </MenuContent>
      )}
      {at?.target === 'layers' && (
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
          <Item label="Paste" kbd="⌘V" disabled={readOnly} run={() => void pasteFromSystemClipboard('normal')} />
          <Item label="Paste on top" kbd="⇧⌘V" disabled={readOnly} run={() => void pasteFromSystemClipboard('over')} />
          <Item label="Paste to replace" kbd="⇧⌘R" disabled={!some || readOnly} run={() => void pasteFromSystemClipboard('replace')} />
          <Item label="Duplicate" kbd="⌘D" disabled={!some || readOnly} run={duplicateSelection} />
          <Divider />
          <Item label="Copy styles" kbd="⌥⌘C" disabled={!some} run={copyStyles} />
          <Item label="Paste styles" kbd="⌥⌘V" disabled={!canPasteStyles} run={pasteStyles} />
          <Divider />
          <Item label="Frame selection" kbd="⇧F" disabled={!some || readOnly} run={frameSelection} />
          <Item label="Add flex layout" kbd="⇧A" disabled={!some || readOnly} run={addFlexOrWrap} />
          <Item label="Ungroup" kbd="⇧⌘G" disabled={!hasChildren || readOnly} run={ungroupSelection} />
          <Divider />
          <Item label="Bring to front" kbd="]" disabled={!some || readOnly} run={() => reorderSelection('front')} />
          <Item label="Send to back" kbd="[" disabled={!some || readOnly} run={() => reorderSelection('back')} />
          <Item label="Move forward" kbd="⌘]" disabled={!some || readOnly} run={() => reorderSelection('forward')} />
          <Item label="Move backward" kbd="⌘[" disabled={!some || readOnly} run={() => reorderSelection('backward')} />
          <Divider />
          <Item label={hidden ? 'Show' : 'Hide'} kbd="⇧⌘H" disabled={!some || readOnly} run={toggleHidden} />
          <Item label={locked ? 'Unlock' : 'Lock'} kbd="⇧⌘L" disabled={!some || readOnly} run={toggleLocked} />
          {frame && !readOnly && (
            <>
              <Divider />
              <Item
                label={thumbnail === frame ? 'Update thumbnail' : 'Use as thumbnail'}
                run={() => {
                  notify('Rendering thumbnail…');
                  void useAsThumbnail(frame);
                }}
              />
              {thumbnail === frame && (
                <Item label="Remove thumbnail" run={() => useEditor.getState().apply('Remove file thumbnail', (d) => { const { thumbnail: _, ...rest } = d; return rest; })} />
              )}
            </>
          )}
        </MenuContent>
      )}
    </Menu.Root>
  );
}
