/**
 * Theme: the project's design tokens, i.e. the custom properties in tokens.css. Grouped by the
 * kind their name prefix implies (color-, spacing-, radius-, font-…). Renaming a token rewrites
 * every var() that uses it.
 */
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { OTHER_GROUP, TOKEN_GROUPS, TOKEN_NAME, removeToken, renameToken, setToken, tokenKind, tokenUsage, uniqueTokenName, type TokenGroup, type TokenKind } from '../document/tokens';
import { useEditor } from '../editor/store';

const apply = useEditor.getState;

export function ThemePanel() {
  const values = useEditor((s) => s.doc.tokens.values);
  const names = Object.keys(values);
  const byKind = (kind: TokenKind) => names.filter((n) => tokenKind(n) === kind);
  const other = byKind('other');
  return (
    <div className="theme" aria-label="Tokens">
      <p className="theme-intro">
        Tokens are CSS variables in <code>tokens.css</code>. Use them from any style field, or as <code>var(--name)</code>.
      </p>
      {TOKEN_GROUPS.map((group) => (
        <TokenGroupSection key={group.kind} group={group} names={byKind(group.kind)} />
      ))}
      {other.length > 0 && <TokenGroupSection group={OTHER_GROUP} names={other} />}
    </div>
  );
}

function TokenGroupSection({ group, names }: { group: TokenGroup; names: string[] }) {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // Select the stable values object; deriving the key list inside the selector would loop.
  const order = Object.keys(useEditor((s) => s.doc.tokens.values));
  const add = () => {
    const doc = apply().doc;
    const base = `${group.prefix}${group.kind === 'color' ? 'new' : names.length + 1}`;
    const name = uniqueTokenName(doc, base);
    apply().apply(`Add ${group.label.toLowerCase()} token`, (d) => setToken(d, name, group.sample));
    setJustAdded(name);
  };
  return (
    <section className="theme-group">
      <div className="left-section-header">
        <span className={`theme-group-title${names.length ? '' : ' is-empty'}`}>
          {group.label}
          {names.length > 0 && <span className="insp-count">{names.length}</span>}
        </span>
        {group.kind !== 'other' && (
          <button type="button" className="icon-button" title={`Add ${group.label.toLowerCase()} token`} aria-label={`Add ${group.label.toLowerCase()} token`} onClick={add}>
            <Plus size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>
      {names.map((name) => (
        // Keyed by position (renaming keeps it), so a rename doesn't remount the row and lose focus.
        <TokenRow key={order.indexOf(name)} name={name} kind={group.kind} autoFocus={name === justAdded} />
      ))}
    </section>
  );
}

function TokenRow({ name, kind, autoFocus }: { name: string; kind: TokenKind; autoFocus: boolean }) {
  const value = useEditor((s) => s.doc.tokens.values[name] ?? '');
  const usage = useEditor((s) => tokenUsage(s.doc, name));
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [valueDraft, setValueDraft] = useState<string | null>(null);
  const draftValid = nameDraft === null || (TOKEN_NAME.test(nameDraft) && (nameDraft === name || !(nameDraft in apply().doc.tokens.values)));

  const commitName = () => {
    if (nameDraft && nameDraft !== name && draftValid) apply().apply('Rename token', (d) => renameToken(d, name, nameDraft));
    setNameDraft(null);
  };

  return (
    <div className="token-row" title={`var(--${name}) · used by ${usage} declaration${usage === 1 ? '' : 's'}`}>
      <TokenPreview kind={kind} name={name} value={value} />
      <input
        className={`token-name${draftValid ? '' : ' is-invalid'}`}
        aria-label="Token name"
        value={nameDraft ?? name}
        spellCheck={false}
        autoFocus={autoFocus}
        onFocus={(e) => autoFocus && e.currentTarget.select()}
        onChange={(e) => setNameDraft(e.target.value.replace(/^--/, ''))}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setNameDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      <input
        className="token-value"
        aria-label={`${name} value`}
        value={valueDraft ?? value}
        spellCheck={false}
        onChange={(e) => {
          setValueDraft(e.target.value);
          if (e.target.value.trim()) apply().apply('Edit token', (d) => setToken(d, name, e.target.value.trim()), { coalesce: `token:${name}` });
        }}
        onBlur={() => setValueDraft(null)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
      />
      <button
        type="button"
        className="icon-button token-delete"
        aria-label={`Delete ${name}`}
        title={usage ? `Delete (still used by ${usage} declaration${usage === 1 ? '' : 's'})` : 'Delete'}
        onClick={() => apply().apply('Delete token', (d) => removeToken(d, name))}
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** A tiny live sample of the token, rendered with the token itself. */
function TokenPreview({ kind, name, value }: { kind: TokenKind; name: string; value: string }) {
  const v = `var(--${name})`;
  const style: React.CSSProperties & Record<string, string> = { [`--${name}`]: value };
  if (kind === 'color') {
    const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : null;
    return (
      <span className="token-preview token-swatch" style={{ ...style, background: v }}>
        {hex && (
          <input
            type="color"
            aria-label={`${name} color`}
            value={hex}
            onChange={(e) => apply().apply('Edit token', (d) => setToken(d, name, e.target.value), { coalesce: `token:${name}` })}
          />
        )}
      </span>
    );
  }
  const sample: Partial<Record<TokenKind, React.CSSProperties>> = {
    font: { fontFamily: v },
    text: { fontSize: `min(${v}, 14px)` },
    'font-weight': { fontWeight: v },
    radius: { borderRadius: `min(${v}, 7px)` },
    shadow: { boxShadow: v },
    opacity: { opacity: v },
    spacing: { width: `clamp(2px, ${v}, 16px)` },
  };
  const textual = kind === 'font' || kind === 'text' || kind === 'font-weight' || kind === 'leading' || kind === 'tracking';
  return (
    <span className={`token-preview token-preview-${kind}`} style={{ ...style, ...sample[kind] }} aria-hidden="true">
      {textual ? 'Aa' : null}
    </span>
  );
}
