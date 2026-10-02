/**
 * Theme: the project's design tokens, i.e. the custom properties in tokens.css. Grouped by the
 * kind their name prefix implies (color-, spacing-, radius-, font-…). Rows read as a list; click
 * one to edit it. Renaming a token rewrites every var() that uses it.
 */
import {
  ALargeSmall, Baseline, Bold, ChevronDown, ChevronRight, Hexagon, Layers2, MoveDiagonal, Plus, Space, SquareDashed, TriangleAlert, Type, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { OTHER_GROUP, TOKEN_GROUPS, TOKEN_NAME, removeToken, renameToken, setToken, tokenKind, tokenUsage, uniqueTokenName, type TokenGroup, type TokenKind } from '../document/tokens';
import { useEditor } from '../editor/store';
import { missingFamily } from '../app/fonts';

const editor = useEditor.getState;

/** Groups in alphabetical order, as in the design; "Other" last. */
const GROUPS: readonly TokenGroup[] = [...TOKEN_GROUPS].sort((a, b) => a.label.localeCompare(b.label));

const KIND_ICONS: Partial<Record<TokenKind, LucideIcon>> = {
  spacing: MoveDiagonal,
  radius: SquareDashed,
  font: Type,
  text: ALargeSmall,
  'font-weight': Bold,
  leading: Baseline,
  tracking: Space,
  shadow: Layers2,
  other: Hexagon,
};

export function ThemePanel() {
  const values = useEditor((s) => s.doc.tokens.values);
  const [editing, setEditing] = useState<string | null>(null);
  const names = Object.keys(values);
  const byKind = (kind: TokenKind) => names.filter((n) => tokenKind(n) === kind);

  const add = (group: TokenGroup) => {
    const doc = editor().doc;
    const existing = byKind(group.kind).length;
    const name = uniqueTokenName(doc, `${group.prefix}${group.kind === 'color' ? 'new' : existing + 1}`);
    editor().apply(`Add ${group.label.toLowerCase()} token`, (d) => setToken(d, name, group.sample));
    setEditing(name);
  };

  const groups = [...GROUPS, OTHER_GROUP].filter((g) => byKind(g.kind).length > 0);
  return (
    <div className="theme" aria-label="Tokens">
      <div className="left-section-header theme-header">
        <span className="theme-header-title">Tokens</span>
        <AddTokenMenu onAdd={add} />
      </div>
      {groups.map((group) => (
        <TokenGroupSection key={group.kind} group={group} names={byKind(group.kind)} order={names} editing={editing} onEdit={setEditing} onAdd={() => add(group)} />
      ))}
      {!groups.length && (
        <p className="theme-empty">
          No tokens yet. Add colors, spacing, radius or type with <Plus size={11} strokeWidth={2} /> above; they are saved to <code>tokens.css</code> as CSS variables.
        </p>
      )}
    </div>
  );
}

function AddTokenMenu({ onAdd }: { onAdd(group: TokenGroup): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  return (
    <span className="insp-menu-anchor" ref={ref}>
      <button type="button" className="icon-button" title="Add token" aria-label="Add token" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus size={13} strokeWidth={1.5} />
      </button>
      {open && (
        <div className="insp-menu" role="menu">
          <div className="rail-menu-title">Add token</div>
          {GROUPS.map((g) => (
            <button
              key={g.kind}
              type="button"
              role="menuitem"
              className="insp-menu-item"
              onClick={() => {
                onAdd(g);
                setOpen(false);
              }}
            >
              <span>{g.label}</span>
              <kbd>--{g.prefix}…</kbd>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

interface GroupProps {
  group: TokenGroup;
  names: string[];
  /** All token names in file order (stable row keys across renames). */
  order: string[];
  editing: string | null;
  onEdit(name: string | null): void;
  onAdd(): void;
}

function TokenGroupSection({ group, names, order, editing, onEdit, onAdd }: GroupProps) {
  const [open, setOpen] = useState(true);
  return (
    <section className="theme-group" aria-label={group.label}>
      <div className="theme-group-header">
        <button type="button" className="left-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
          {group.label}
        </button>
        {group.kind !== 'other' && (
          <button type="button" className="icon-button theme-group-add" title={`Add ${group.label.toLowerCase()} token`} aria-label={`Add ${group.label.toLowerCase()} token`} onClick={onAdd}>
            <Plus size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {open &&
        names.map((name) =>
          // Keyed by file position (a rename keeps it), so renaming doesn't remount the row.
          editing === name ? (
            <TokenEditor key={order.indexOf(name)} name={name} kind={group.kind} onDone={() => onEdit(null)} />
          ) : (
            <TokenRow key={order.indexOf(name)} name={name} kind={group.kind} onEdit={() => onEdit(name)} />
          ),
        )}
    </section>
  );
}

/** Compact display value: px drops its unit, opacity reads as a percentage, fonts show the family. */
export function displayValue(kind: TokenKind, value: string): string {
  const v = value.trim();
  if (kind === 'color') return '';
  if (/^-?\d*\.?\d+px$/.test(v)) return v.slice(0, -2);
  if (kind === 'opacity' && /^\d*\.?\d+$/.test(v)) return `${Math.round(parseFloat(v) * 100)}%`;
  if (kind === 'font') return v.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
  return v;
}

function TokenIcon({ kind, value }: { kind: TokenKind; value: string }) {
  if (kind === 'color') return <span className="token-icon token-swatch" style={{ background: value }} aria-hidden="true" />;
  if (kind === 'opacity') return <span className="token-icon token-checker" aria-hidden="true" />;
  const Icon = KIND_ICONS[kind] ?? Hexagon;
  return (
    <span className="token-icon" aria-hidden="true">
      <Icon size={14} strokeWidth={1.5} />
    </span>
  );
}

function TokenRow({ name, kind, onEdit }: { name: string; kind: TokenKind; onEdit(): void }) {
  const value = useEditor((s) => s.doc.tokens.values[name] ?? '');
  const usage = useEditor((s) => tokenUsage(s.doc, name));
  const tokens = useEditor((s) => s.doc.tokens.values);
  const missing = kind === 'font' ? missingFamily(value, tokens) : null;
  const title = `var(--${name}): ${value} · used ${usage}×.${missing ? ` ${missing} isn’t installed on this computer; a fallback is shown.` : ''} Click to edit.`;
  return (
    <button type="button" className={`token-row${missing ? ' is-missing' : ''}`} onClick={onEdit} title={title}>
      <TokenIcon kind={kind} value={value} />
      <span className="token-name">{name}</span>
      {missing && <TriangleAlert size={12} strokeWidth={1.75} className="token-missing" aria-label="Font not installed" />}
      <span className="token-value">{displayValue(kind, value)}</span>
    </button>
  );
}

/** A row in edit mode: name and value fields; leaves edit mode when focus leaves the row. */
function TokenEditor({ name, kind, onDone }: { name: string; kind: TokenKind; onDone(): void }) {
  const value = useEditor((s) => s.doc.tokens.values[name] ?? '');
  const [nameDraft, setNameDraft] = useState(name);
  const [valueDraft, setValueDraft] = useState<string | null>(null);
  const nameValid = nameDraft === name || (TOKEN_NAME.test(nameDraft) && !(nameDraft in editor().doc.tokens.values));

  const commitName = () => {
    if (nameDraft !== name && nameValid) editor().apply('Rename token', (d) => renameToken(d, name, nameDraft));
  };
  const finish = () => {
    commitName();
    onDone();
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    finish();
  };

  return (
    <div className="token-row is-editing" onBlur={onBlur}>
      {kind === 'color' ? (
        <label className="token-icon token-swatch" style={{ background: value }} title="Pick a color">
          <input
            type="color"
            aria-label={`${name} color`}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
            onChange={(e) => editor().apply('Edit token', (d) => setToken(d, name, e.target.value), { coalesce: `token:${name}` })}
          />
        </label>
      ) : (
        <TokenIcon kind={kind} value={value} />
      )}
      <input
        className={`token-input token-input-name${nameValid ? '' : ' is-invalid'}`}
        aria-label="Token name"
        value={nameDraft}
        spellCheck={false}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setNameDraft(e.target.value.replace(/^--/, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish();
          if (e.key === 'Escape') onDone();
        }}
      />
      <input
        className="token-input token-input-value"
        aria-label={`${name} value`}
        value={valueDraft ?? value}
        spellCheck={false}
        onChange={(e) => {
          setValueDraft(e.target.value);
          if (e.target.value.trim()) editor().apply('Edit token', (d) => setToken(d, name, e.target.value.trim()), { coalesce: `token:${name}` });
        }}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && finish()}
      />
      <button
        type="button"
        className="icon-button token-delete"
        aria-label={`Delete ${name}`}
        title="Delete token"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor().apply('Delete token', (d) => removeToken(d, name));
          onDone();
        }}
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}
