/**
 * Inspector controls. Style controls read the *declared* value from each element's primary
 * class rule and show the browser's *computed* value as the placeholder, so you always see
 * both what the CSS says and what the browser did with it.
 */
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { domElement, styleOf } from '../../canvas/dom';
import { setStyleOnNodes } from '../../document/ops';
import { getElement } from '../../document/tree';
import type { DesignDocument, NodeId } from '../../document/types';
import { useEditor } from '../../editor/store';

export const MIXED = '\u0000mixed';

export function Section({ title, children, defaultOpen = true, aside }: { title: string; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section">
      <div className="section-header">
        <button type="button" className="section-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {aside}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field-row" title={hint}>
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="field-grid">{children}</div>;
}

interface TextInputProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>, current: string): void;
  ariaLabel?: string;
}

/** Text input that keeps its own draft while focused (so "1px solid" survives trimming). */
export function TextInput({ value, onChange, placeholder, multiline, mono, onKeyDown, ariaLabel }: TextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const className = `text-input${mono ? ' is-mono' : ''}`;
  if (multiline) {
    return (
      <textarea
        className={className}
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
    );
  }
  return (
    <input
      className={className}
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
}

// --- style plumbing ---------------------------------------------------------------------------

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

export function useDeclared(ids: readonly NodeId[], prop: string): string {
  return useEditor((s) => declaredValue(s.doc, ids, prop));
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

export function CssInput({ ids, prop, placeholder }: { ids: readonly NodeId[]; prop: string; placeholder?: string }) {
  const declared = useDeclared(ids, prop);
  const computed = computedValue(ids[0], prop);
  const mixed = declared === MIXED;
  return (
    <TextInput
      ariaLabel={prop}
      value={mixed ? '' : declared}
      placeholder={mixed ? 'Mixed' : placeholder ?? computed}
      onChange={(v) => setStyle(ids, prop, v)}
      onKeyDown={(e, current) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const next = stepValue(current, computed, e.key === 'ArrowUp' ? 1 : -1, e);
        if (next === null) return;
        e.preventDefault();
        setStyle(ids, prop, next);
      }}
    />
  );
}

export function CssField({ ids, prop, label, placeholder }: { ids: readonly NodeId[]; prop: string; label: string; placeholder?: string }) {
  return (
    <Row label={label} hint={prop}>
      <CssInput ids={ids} prop={prop} placeholder={placeholder} />
    </Row>
  );
}

export interface Choice {
  readonly value: string;
  readonly label: ReactNode;
  readonly title?: string;
}

export function Segmented({ value, choices, onChange, ariaLabel }: { value: string; choices: readonly Choice[]; onChange(value: string): void; ariaLabel: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          title={c.title ?? (typeof c.label === 'string' ? c.label : c.value)}
          className={`segment${value === c.value ? ' is-active' : ''}`}
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** Segmented control bound to a CSS property. `value` falls back to the computed value. */
export function CssSegmented({ ids, prop, label, choices }: { ids: readonly NodeId[]; prop: string; label: string; choices: readonly Choice[] }) {
  const declared = useDeclared(ids, prop);
  const current = declared === MIXED ? '' : declared || computedValue(ids[0], prop);
  return (
    <Row label={label} hint={prop}>
      <Segmented ariaLabel={label} value={current} choices={choices} onChange={(v) => setStyle(ids, prop, v)} />
    </Row>
  );
}

export function CssSelect({ ids, prop, label, options }: { ids: readonly NodeId[]; prop: string; label: string; options: readonly string[] }) {
  const declared = useDeclared(ids, prop);
  const computed = computedValue(ids[0], prop);
  return (
    <Row label={label} hint={prop}>
      <select className="select-input" aria-label={label} value={declared === MIXED ? '' : declared} onChange={(e) => setStyle(ids, prop, e.target.value)}>
        <option value="">{declared === MIXED ? 'Mixed' : computed ? `— ${computed}` : '—'}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Row>
  );
}

function toHex(color: string): string {
  if (/^rgba\(.*,\s*0\)$/.test(color) || color === 'transparent') return '#ffffff';
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (m) return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000';
}

export function ColorField({ ids, prop, label }: { ids: readonly NodeId[]; prop: string; label: string }) {
  const declared = useDeclared(ids, prop);
  const computed = computedValue(ids[0], prop === 'background' ? 'background-color' : prop);
  const value = declared === MIXED ? '' : declared;
  return (
    <Row label={label} hint={prop}>
      <div className="color-field">
        <input
          type="color"
          className="color-swatch"
          aria-label={`${label} color`}
          value={toHex(value || computed)}
          onChange={(e) => setStyle(ids, prop, e.target.value)}
        />
        <CssInput ids={ids} prop={prop} placeholder={declared === MIXED ? 'Mixed' : computed} />
      </div>
    </Row>
  );
}
