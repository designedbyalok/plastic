/**
 * Inspector controls. Style controls read the *declared* value from each element's primary
 * class rule and show the browser's *computed* value as the placeholder, so you always see
 * both what the CSS says and what the browser did with it.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { domElement, styleOf } from '../../canvas/dom.ts';
import { setStyleOnNodes } from '../../document/ops.ts';
import { groupFor, setToken, tokenKind, tokenKindForProperty, tokenReference, tokenVar, uniqueTokenName, type TokenKind } from '../../document/tokens.ts';
import { getElement } from '../../document/tree.ts';
import type { DesignDocument, NodeId } from '../../document/types.ts';
import { useEditor } from '../../editor/store.ts';
import { Check, ChevronDown, Hexagon, Minus, Plus, X } from 'lucide-react';

export const MIXED = '\u0000mixed';

// --- layout primitives -----------------------------------------------------------------------

interface SectionProps {
  title: ReactNode;
  children?: ReactNode;
  /** Nothing set yet: the title is muted and only a + is shown. */
  empty?: boolean;
  onAdd?(): void;
  onRemove?(): void;
  aside?: ReactNode;
}

export function Section({ title, children, empty, onAdd, onRemove, aside }: SectionProps) {
  return (
    <section className="insp-section">
      <div className="insp-header">
        <span className={`insp-title${empty ? ' is-empty' : ''}`}>{title}</span>
        <span className="insp-header-actions">
          {aside}
          {empty && onAdd && (
            <button type="button" className="icon-button" aria-label={`Add ${typeof title === 'string' ? title.toLowerCase() : ''}`} onClick={onAdd}>
              <Plus size={12} strokeWidth={1.5} />
            </button>
          )}
          {!empty && onRemove && (
            <button type="button" className="icon-button" aria-label={`Remove ${typeof title === 'string' ? title.toLowerCase() : ''}`} onClick={onRemove}>
              <Minus size={12} strokeWidth={1.5} />
            </button>
          )}
        </span>
      </div>
      {!empty && children && <div className="insp-body">{children}</div>}
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="insp-row">{children}</div>;
}

/** A row with a text label on the left, for semantic attributes. */
export function LabeledRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="insp-row insp-labeled" title={hint}>
      <span className="insp-label">{label}</span>
      <div className="insp-control">{children}</div>
    </div>
  );
}

// --- inputs ------------------------------------------------------------------------------------

interface TextInputProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  /** Short label inside the field (X, W, Gap…). */
  prefix?: ReactNode;
  suffix?: ReactNode;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>, current: string): void;
  ariaLabel?: string;
}

/** Text input that keeps its own draft while focused (so "1px solid" survives trimming). */
export function TextInput({ value, onChange, placeholder, multiline, mono, prefix, suffix, onKeyDown, ariaLabel }: TextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const className = `insp-input${mono ? ' is-mono' : ''}${prefix ? ' has-prefix' : ''}${suffix ? ' has-suffix' : ''}`;
  // Text prefixes ("X", "Gap", "Min W") reserve room for themselves before the value.
  const style = typeof prefix === 'string' && prefix.length > 1 ? { paddingLeft: prefix.length * 6.5 + 14 } : undefined;
  const field = multiline ? (
    <textarea
      className={className}
      style={style}
      aria-label={ariaLabel}
      value={shown}
      placeholder={placeholder}
      rows={Math.min(6, Math.max(2, shown.split('\n').length))}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  ) : (
    <input
      className={className}
      style={style}
      aria-label={ariaLabel}
      value={shown}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        onKeyDown?.(e, shown);
      }}
    />
  );
  if (!prefix && !suffix) return field;
  return (
    <span className="insp-field">
      {field}
      {prefix && <span className="insp-prefix">{prefix}</span>}
      {suffix && <span className="insp-suffix">{suffix}</span>}
    </span>
  );
}

export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange(checked: boolean): void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="insp-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="insp-check-box" aria-hidden="true">
        <Check size={11} strokeWidth={2.25} />
      </span>
      <span>{label}</span>
      {hint && <span className="insp-check-hint">{hint}</span>}
    </label>
  );
}

export function Select({ value, onChange, options, placeholder, ariaLabel, mono, prefix }: { value: string; onChange(v: string): void; options: readonly (string | { value: string; label: string })[]; placeholder?: string; ariaLabel: string; mono?: boolean; prefix?: ReactNode }) {
  return (
    <span className="insp-select-wrap">
    <select className={`insp-select${mono ? ' is-mono' : ''}${prefix ? ' has-prefix' : ''}${value === '' ? ' is-placeholder' : ''}`} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        );
      })}
    </select>
      {prefix && <span className="insp-prefix">{prefix}</span>}
      <ChevronDown size={12} strokeWidth={1.5} className="insp-select-chevron" aria-hidden="true" />
    </span>
  );
}

export interface Choice {
  readonly value: string;
  readonly label: ReactNode;
  readonly title?: string;
}

export function Segmented({ value, choices, onChange, ariaLabel }: { value: string; choices: readonly Choice[]; onChange(value: string): void; ariaLabel: string }) {
  return (
    <div className="insp-segmented" role="radiogroup" aria-label={ariaLabel}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          title={c.title ?? (typeof c.label === 'string' ? c.label : c.value)}
          className={`insp-segment${value === c.value ? ' is-active' : ''}`}
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

// --- style plumbing ----------------------------------------------------------------------------

export function declaredValue(doc: DesignDocument, ids: readonly NodeId[], prop: string): string {
  const values = new Set(
    ids.map((id) => {
      const cls = getElement(doc, id)?.classes[0];
      return (cls && doc.styles.rules[cls]?.[prop]) ?? '';
    }),
  );
  return values.size === 1 ? [...values][0]! : MIXED;
}

export function computedValue(id: NodeId | undefined, prop: string): string {
  const el = domElement(id);
  return el ? styleOf(el).getPropertyValue(prop) : '';
}

export function setStyle(ids: readonly NodeId[], prop: string, value: string): void {
  useEditor.getState().apply(`Set ${prop}`, (d) => setStyleOnNodes(d, ids, prop, value.trim() || null), {
    coalesce: `css:${ids.join(',')}:${prop}`,
  });
}

/** Remove several declarations as one undo step (a section's − button). */
export function clearStyles(ids: readonly NodeId[], props: readonly string[], label: string): void {
  useEditor.getState().apply(label, (d) => props.reduce((acc, p) => setStyleOnNodes(acc, ids, p, null), d));
}

export function useDeclared(ids: readonly NodeId[], prop: string): string {
  return useEditor((s) => declaredValue(s.doc, ids, prop));
}

/** Whether any of the props is declared on the selection (decides empty vs. expanded sections). */
export function useAnyDeclared(ids: readonly NodeId[], props: readonly string[]): boolean {
  return useEditor((s) => props.some((p) => declaredValue(s.doc, ids, p) !== ''));
}

const NUMBER_WITH_UNIT = /^(-?\d*\.?\d+)([a-z%]*)$/i;

/** ArrowUp/Down nudges numeric values (Shift ×10, Alt ×0.1), like in browser devtools. */
function stepValue(current: string, fallback: string, direction: 1 | -1, e: KeyboardEvent): string | null {
  const source = current.trim() || fallback.trim();
  const match = NUMBER_WITH_UNIT.exec(source);
  if (!match) return null;
  const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
  const next = Math.round((parseFloat(match[1]!) + direction * step) * 100) / 100;
  return `${next}${match[2] || (current.trim() ? '' : 'px')}`;
}

/** Show "240" rather than "240px" in compact numeric fields; other units stay visible. */
function compactPx(value: string): string {
  return /^-?\d*\.?\d+px$/.test(value) ? value.slice(0, -2) : value;
}

function expandPx(value: string): string {
  return /^-?\d*\.?\d+$/.test(value.trim()) ? `${value.trim()}px` : value;
}

interface CssInputProps {
  ids: readonly NodeId[];
  prop: string;
  placeholder?: string;
  prefix?: ReactNode;
  /** Numeric field: shows px values without the unit and treats bare numbers as px. */
  numeric?: boolean;
  mono?: boolean;
  /** Set by wrappers that provide their own token slot. */
  noToken?: boolean;
}

export function CssInput({ ids, prop, placeholder, prefix, numeric, mono, noToken }: CssInputProps) {
  const declared = useDeclared(ids, prop);
  const computed = computedValue(ids[0], prop);
  const mixed = declared === MIXED;
  const show = (v: string) => (numeric ? compactPx(v) : v);
  const input = (
    <TextInput
      ariaLabel={prop}
      prefix={prefix}
      mono={mono}
      value={mixed ? '' : show(declared)}
      placeholder={mixed ? 'Mixed' : placeholder ?? show(roundPx(computed))}
      onChange={(v) => setStyle(ids, prop, numeric ? expandPx(v) : v)}
      onKeyDown={(e, current) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const next = stepValue(numeric ? expandPx(current) : current, computed, e.key === 'ArrowUp' ? 1 : -1, e);
        if (next === null) return;
        e.preventDefault();
        setStyle(ids, prop, next);
      }}
    />
  );
  return noToken ? input : <TokenSlot ids={ids} prop={prop} prefix={prefix}>{input}</TokenSlot>;
}

/** Computed lengths like "143.594px" are noise in a placeholder; round them. */
function roundPx(value: string): string {
  return value.replace(/(-?\d+\.\d+)px/g, (_, n: string) => `${Math.round(parseFloat(n) * 10) / 10}px`);
}

export function CssSelect({ ids, prop, label, options }: { ids: readonly NodeId[]; prop: string; label: string; options: readonly string[] }) {
  const declared = useDeclared(ids, prop);
  return (
    <Select
      ariaLabel={label}
      value={declared === MIXED ? '' : declared}
      placeholder={declared === MIXED ? 'Mixed' : label}
      options={options}
      onChange={(v) => setStyle(ids, prop, v)}
    />
  );
}

export function CssSegmented({ ids, prop, label, choices }: { ids: readonly NodeId[]; prop: string; label: string; choices: readonly Choice[] }) {
  const declared = useDeclared(ids, prop);
  const current = declared === MIXED ? '' : declared || computedValue(ids[0], prop);
  return <Segmented ariaLabel={label} value={current} choices={choices} onChange={(v) => setStyle(ids, prop, v)} />;
}

function toHex(color: string): string {
  if (/^rgba\(.*,\s*0\)$/.test(color) || color === 'transparent') return '#ffffff';
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
}

/** Swatch + value, like a fill row. Any CSS value (gradients, variables) is accepted as text. */
export function ColorInput({ ids, prop, computedProp }: { ids: readonly NodeId[]; prop: string; computedProp?: string }) {
  const declared = useDeclared(ids, prop);
  const computed = computedValue(ids[0], computedProp ?? prop);
  const value = declared === MIXED ? '' : declared;
  return (
    <TokenSlot ids={ids} prop={prop}>
    <span className="insp-field">
      <CssInput ids={ids} prop={prop} placeholder={declared === MIXED ? 'Mixed' : computed} prefix={<span />} noToken />
      <span className="insp-prefix">
        <input
          type="color"
          className="insp-swatch"
          aria-label={`${prop} color`}
          value={toHex(value || computed)}
          onChange={(e) => setStyle(ids, prop, e.target.value)}
        />
      </span>
    </span>
    </TokenSlot>
  );
}

/** Range slider bound to a numeric CSS value, paired with a text field. */
export function CssSlider({ ids, prop, min, max, step = 1, unit = 'px', scale = 1, label }: { ids: readonly NodeId[]; prop: string; min: number; max: number; step?: number; unit?: string; scale?: number; label: string }) {
  const declared = useDeclared(ids, prop);
  const computed = computedValue(ids[0], prop);
  const numeric = parseFloat(declared === MIXED ? '' : declared || computed) || 0;
  return (
    <input
      type="range"
      className="insp-slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={Math.min(max, numeric * scale)}
      style={{ ['--fill' as string]: `${((Math.min(max, numeric * scale) - min) / (max - min)) * 100}%` }}
      onChange={(e) => setStyle(ids, prop, `${Number(e.target.value) / scale}${unit}`)}
    />
  );
}

// --- tokens ------------------------------------------------------------------------------------

/**
 * Wraps a style field with token binding. A value of exactly `var(--name)` shows as a token
 * chip; otherwise a token button opens a picker of tokens that fit the property.
 */
export function TokenSlot({ ids, prop, prefix, children }: { ids: readonly NodeId[]; prop: string; prefix?: ReactNode; children: ReactNode }) {
  const kind = tokenKindForProperty(prop);
  const declared = useDeclared(ids, prop);
  const bound = declared === MIXED ? null : tokenReference(declared);
  const [open, setOpen] = useState(false);
  if (!kind) return <>{children}</>;
  return (
    <span className={`insp-field insp-token-slot${open ? ' is-open' : ''}`}>
      {bound ? <TokenChip name={bound} kind={kind} prefix={prefix} onOpen={() => setOpen(true)} onDetach={() => detachToken(ids, prop, bound)} /> : children}
      {!bound && (
        <button type="button" className="insp-token-button" title="Use a token" aria-label={`Use a token for ${prop}`} onClick={() => setOpen(!open)}>
          <Hexagon size={11} strokeWidth={1.75} />
        </button>
      )}
      {open && <TokenPicker ids={ids} prop={prop} kind={kind} current={declared === MIXED ? '' : declared} onClose={() => setOpen(false)} />}
    </span>
  );
}

function detachToken(ids: readonly NodeId[], prop: string, name: string): void {
  const value = useEditor.getState().doc.tokens.values[name] ?? '';
  useEditor.getState().apply('Detach token', (d) => setStyleOnNodes(d, ids, prop, value || null));
}

function TokenChip({ name, kind, prefix, onOpen, onDetach }: { name: string; kind: TokenKind; prefix?: ReactNode; onOpen(): void; onDetach(): void }) {
  const value = useEditor((s) => s.doc.tokens.values[name]);
  return (
    <span className={`insp-token-chip${value === undefined ? ' is-missing' : ''}`} title={value === undefined ? `var(--${name}) is not defined in tokens.css` : `var(--${name}) = ${value}`}>
      {prefix && typeof prefix !== 'object' && <span className="insp-token-chip-prefix">{prefix}</span>}
      <button type="button" className="insp-token-chip-main" onClick={onOpen}>
        {kind === 'color' ? <span className="insp-token-chip-swatch" style={{ background: value }} /> : <Hexagon size={11} strokeWidth={1.75} />}
        <span className="insp-token-chip-name">{name}</span>
      </button>
      <button type="button" className="insp-token-chip-detach" aria-label={`Detach ${name}`} title="Detach (use the raw value)" onClick={onDetach}>
        <X size={11} strokeWidth={1.75} />
      </button>
    </span>
  );
}

function TokenPicker({ ids, prop, kind, current, onClose }: { ids: readonly NodeId[]; prop: string; kind: TokenKind; current: string; onClose(): void }) {
  const values = useEditor((s) => s.doc.tokens.values);
  const ref = useRef<HTMLDivElement>(null);
  const group = groupFor(kind);
  const names = Object.keys(values).filter((n) => tokenKind(n) === kind);
  const raw = current && !tokenReference(current) ? current : '';

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const bind = (name: string) => {
    useEditor.getState().apply('Use token', (d) => setStyleOnNodes(d, ids, prop, tokenVar(name)));
    onClose();
  };
  const saveAsToken = () => {
    const doc = useEditor.getState().doc;
    const name = uniqueTokenName(doc, `${group.prefix}${kind === 'color' ? 'new' : names.length + 1}`);
    useEditor.getState().apply('Create token', (d) => setStyleOnNodes(setToken(d, name, raw), ids, prop, tokenVar(name)));
    onClose();
  };

  return (
    <div className="insp-menu insp-token-picker" role="menu" ref={ref}>
      <div className="rail-menu-title">{group.label}</div>
      {names.map((name) => (
        <button key={name} type="button" role="menuitem" className="insp-menu-item" onClick={() => bind(name)}>
          {kind === 'color' ? <span className="insp-token-chip-swatch" style={{ background: values[name] }} /> : <Hexagon size={11} strokeWidth={1.75} />}
          <span>{name}</span>
          <kbd>{values[name]}</kbd>
        </button>
      ))}
      {!names.length && <div className="insp-token-empty">No {group.label.toLowerCase()} tokens yet.</div>}
      <div className="insp-menu-divider" />
      {raw && (
        <button type="button" role="menuitem" className="insp-menu-item" onClick={saveAsToken}>
          <Plus size={12} strokeWidth={1.75} />
          <span>Save “{raw}” as a token</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className="insp-menu-item"
        onClick={() => {
          useEditor.getState().setLayersOpen(true);
          useEditor.getState().setLeftTab('theme');
          onClose();
        }}
      >
        <span>Edit tokens…</span>
      </button>
    </div>
  );
}
