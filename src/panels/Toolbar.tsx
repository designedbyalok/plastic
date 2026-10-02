import { Code, Layers3, Minus, Plus, Redo2, Rows3, Undo2 } from 'lucide-react';
import { setTitle } from '../document/ops';
import { INSERTABLES } from '../elements/insertables';
import { wrapSelectionInStack, zoomBy, zoomTo } from '../editor/commands';
import { useEditor, type Tool } from '../editor/store';
import { INSERT_ICONS, TOOL_ICONS } from './icons';

function sameTool(a: Tool, b: Tool): boolean {
  return a.kind === b.kind && (a.kind !== 'insert' || (b.kind === 'insert' && a.itemId === b.itemId));
}

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const title = useEditor((s) => s.doc.title);
  const zoom = useEditor((s) => s.viewport.zoom);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past[s.history.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.history.future[0]?.label);
  const codeOpen = useEditor((s) => s.codeOpen);
  const canWrap = useEditor((s) => s.selection.some((id) => !s.doc.roots.includes(id)));
  const store = useEditor.getState;

  const toolButton = (t: Tool, label: string, shortcut: string | undefined, Icon: typeof Plus) => (
    <button
      key={t.kind === 'insert' ? t.itemId : t.kind}
      type="button"
      className={`tool-button${sameTool(tool, t) ? ' is-active' : ''}`}
      title={shortcut ? `${label} (${shortcut.toUpperCase()})` : label}
      aria-label={label}
      aria-pressed={sameTool(tool, t)}
      onClick={() => store().setTool(sameTool(tool, t) ? { kind: 'select' } : t)}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );

  return (
    <header className="toolbar">
      <div className="toolbar-group">
        <span className="brand">
          <Layers3 size={16} strokeWidth={2} /> Plastic
        </span>
        {toolButton({ kind: 'select' }, 'Select', 'v', TOOL_ICONS.select)}
        {toolButton({ kind: 'frame' }, 'Frame', 'f', TOOL_ICONS.frame)}
        <span className="toolbar-divider" />
        {INSERTABLES.map((item) => toolButton({ kind: 'insert', itemId: item.id }, item.label, item.shortcut, INSERT_ICONS[item.id] ?? Plus))}
      </div>

      <input
        className="doc-title"
        aria-label="Document title"
        value={title}
        onChange={(e) => store().apply('Rename document', (d) => setTitle(d, e.target.value), { coalesce: 'title' })}
      />

      <div className="toolbar-group">
        <button type="button" className="tool-button" disabled={!canWrap} title="Wrap in stack (Shift+A)" aria-label="Wrap in stack" onClick={wrapSelectionInStack}>
          <Rows3 size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="tool-button" disabled={!canUndo} title={`Undo ${undoLabel ?? ''} (⌘Z)`} aria-label="Undo" onClick={() => store().undo()}>
          <Undo2 size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="tool-button" disabled={!canRedo} title={`Redo ${redoLabel ?? ''} (⇧⌘Z)`} aria-label="Redo" onClick={() => store().redo()}>
          <Redo2 size={16} strokeWidth={1.75} />
        </button>
        <span className="toolbar-divider" />
        <button type="button" className="tool-button" title="Zoom out (⌘-)" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={14} />
        </button>
        <button type="button" className="zoom-label" title="Reset to 100% (⇧0)" onClick={() => zoomTo(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="tool-button" title="Zoom in (⌘=)" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={14} />
        </button>
        <span className="toolbar-divider" />
        <button
          type="button"
          className={`tool-button${codeOpen ? ' is-active' : ''}`}
          title="Show HTML / CSS"
          aria-label="Show code"
          aria-pressed={codeOpen}
          onClick={() => store().setCodeOpen(!codeOpen)}
        >
          <Code size={16} strokeWidth={1.75} />
        </button>
        <SaveStatus />
      </div>
    </header>
  );
}

function SaveStatus() {
  const status = useEditor((s) => s.saveStatus);
  const dirty = useEditor((s) => s.revision !== s.savedRevision);
  const location = useEditor((s) => s.storageLocation);
  const text = status === 'error' ? 'Save failed' : status === 'saving' || dirty ? 'Saving…' : 'Saved';
  return (
    <span className={`save-status is-${status === 'error' ? 'error' : dirty ? 'dirty' : 'saved'}`} title={location ? `Saved to ${location}` : undefined}>
      {text}
      {location && <span className="save-location"> · {location}</span>}
    </span>
  );
}
