import { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import {
  BASE_VARIANT,
  STYLE_STATES,
  setVariantDeclaration,
  variantDeclarations,
  variantWidths,
  type StyleVariant,
} from '../../document/variants.ts';
import type { ElementNode } from '../../document/types.ts';
import { useEditor } from '../../editor/store.ts';
import { Row, Select, TextInput } from './fields.tsx';

export function VariantsSection({ el }: { el: ElementNode }) {
  const styles = useEditor((s) => s.doc.styles);
  const preview = useEditor((s) => s.stylePreview);
  const [variant, setVariant] = useState<StyleVariant>(BASE_VARIANT);
  const [open, setOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState('');
  const [declaration, setDeclaration] = useState('');
  const widths = [
    ...new Set([375, 768, 1024, ...variantWidths(styles), ...(variant.maxWidth ? [variant.maxWidth] : [])]),
  ].sort((a, b) => a - b);
  const base = variant.maxWidth === null && variant.state === 'default';
  const declared = open && !base && el.classes[0] ? variantDeclarations(styles, el.classes[0], variant) : {};
  const active = preview?.id === el.id;
  const update = (next: StyleVariant) => {
    setVariant(next);
    if (active) useEditor.setState({ stylePreview: { ...next, id: el.id } });
  };
  useEffect(
    () => () => {
      if (useEditor.getState().stylePreview?.id === el.id) useEditor.setState({ stylePreview: null });
    },
    [el.id],
  );
  const write = (prop: string, value: string | null) =>
    useEditor
      .getState()
      .apply(`Edit ${variant.state} style`, (d) => setVariantDeclaration(d, el.id, variant, prop, value), {
        coalesce: `variant:${el.id}:${variant.maxWidth}:${variant.state}:${prop}`,
      });
  return (
    <section className="insp-section">
      <button type="button" className="insp-source-toggle" aria-expanded={open} onClick={() => {
        setOpen(!open);
        if (open && active) useEditor.setState({ stylePreview: null });
      }}>
        <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>Responsive &amp; States</span>
      </button>
      {open && <div className="insp-body">
      <Row>
        <Select
          ariaLabel="Style breakpoint"
          value={variant.maxWidth === null ? 'all' : String(variant.maxWidth)}
          options={[
            { value: 'all', label: 'All Widths' },
            ...widths.map((w) => ({ value: String(w), label: `≤ ${w}px` })),
          ]}
          onChange={(v) => update({ ...variant, maxWidth: v === 'all' ? null : Number(v) })}
        />
        <Select
          ariaLabel="Style state"
          value={variant.state}
          options={STYLE_STATES.map((state) => ({
            value: state,
            label: state === 'default' ? 'Default' : `:${state}`,
          }))}
          onChange={(state) => update({ ...variant, state: state as StyleVariant['state'] })}
        />
      </Row>
      <Row>
        <input
          className="insp-input"
          aria-label="Custom breakpoint width"
          placeholder="Custom Width (px)"
          title="Press Enter to add this breakpoint"
          inputMode="numeric"
          value={customWidth}
          onChange={(e) => setCustomWidth(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const width = Number(customWidth);
            if (!Number.isFinite(width) || width <= 0 || width > 10000) return;
            update({ ...variant, maxWidth: width });
            setCustomWidth('');
          }}
        />
        <button
          type="button"
          className="insp-button"
          aria-pressed={active}
          onClick={() => useEditor.setState({ stylePreview: active ? null : { ...variant, id: el.id } })}
        >
          {active ? 'Stop Preview' : 'Preview'}
        </button>
      </Row>
      <Row>
        <code>
          {el.classes[0] ? `.${el.classes[0]}` : 'Element'}
          {variant.state === 'default' ? '' : `:${variant.state}`}
          {variant.maxWidth === null ? '' : ` · ≤ ${variant.maxWidth}px`}
        </code>
      </Row>
      {base ? <p className="insp-source-body">Base styles are edited in Layout, Fill, Text and the other controls above. Choose a breakpoint or state here to edit overrides.</p> : <>
      <Row>
        <TextInput
          key={`color:${variant.maxWidth}:${variant.state}`}
          value={declared.color ?? ''}
          prefix="Color"
          ariaLabel="Variant color"
          onFocus={() => useEditor.setState({ styleSourceProperty: 'color' })}
          placeholder="Inherit"
          onChange={(v) => write('color', v)}
        />
        <TextInput
          key={`width:${variant.maxWidth}:${variant.state}`}
          value={declared.width ?? ''}
          prefix="W"
          ariaLabel="Variant width"
          onFocus={() => useEditor.setState({ styleSourceProperty: 'width' })}
          placeholder="Inherit"
          onChange={(v) => write('width', v)}
        />
      </Row>
      {Object.entries(declared)
        .filter(([p]) => p !== 'color' && p !== 'width')
        .map(([prop, val]) => (
          <Row key={`${variant.maxWidth}:${variant.state}:${prop}`}>
            <code>{prop}</code>
            <TextInput value={val} ariaLabel={`Variant ${prop}`} onFocus={() => useEditor.setState({ styleSourceProperty: prop })} mono onChange={(v) => write(prop, v)} />
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove variant ${prop}`}
              onClick={() => write(prop, null)}
            >
              <X size={12} />
            </button>
          </Row>
        ))}
      <Row>
        <input
          className="insp-input is-mono"
          aria-label="New variant declaration"
          placeholder="property: value"
          value={declaration}
          spellCheck={false}
          onChange={(e) => setDeclaration(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const colon = declaration.indexOf(':');
            if (colon < 1) return;
            write(
              declaration.slice(0, colon).trim(),
              declaration
                .slice(colon + 1)
                .trim()
                .replace(/;$/, ''),
            );
            setDeclaration('');
          }}
        />
      </Row>
      </>}
      </div>}
    </section>
  );
}
