/**
 * Presentation sections, ordered like a design tool (Layout, Radius, Opacity, Fill…) but every
 * control writes a plain CSS declaration. Optional sections stay collapsed behind a + until
 * something is set, and − clears exactly the declarations that section owns.
 */
import {
  ALargeSmall, Angle, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUpToLine, Baseline, Bold, Check, ChevronDown, FlipHorizontal2, FlipVertical2, FoldVertical,
  LayoutGrid, RotateCwSquare, SlidersVertical, Space, Strikethrough, TextAlignCenter, TextAlignEnd, TextAlignStart, TriangleAlert, Type, Underline, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { domElement, isOutOfFlow, styleOf } from '../../canvas/dom.ts';
import { setDeclaration, setFrame, setStyleOnNodes } from '../../document/ops.ts';
import { getElement, getParentId, isRoot } from '../../document/tree.ts';
import type { ElementNode, NodeId } from '../../document/types.ts';
import { elementSpec } from '../../elements/registry.ts';
import { tokenKind, tokenReference, tokenVar, type TokenKind } from '../../document/tokens.ts';
import { addFlexOrWrap, setFreePositioning } from '../../editor/commands.ts';
import { useEditor } from '../../editor/store.ts';
import { missingFamily } from '../../app/fonts.ts';
import { colorWithAlpha, cssGradient, gradientFrom, parseColor, parseCssGradient } from '../../paint/gradient.ts';
import { GradientEditor } from './GradientEditor.tsx';
import {
  Checkbox, ColorInput, CssInput, CssSelect, CssSlider, MIXED, Row, Section, Segmented, Select, TextInput, TokenSlot, type Choice,
  clearStyles, computedValue, setStyle, useAnyDeclared, useDeclared,
} from './fields.tsx';

type Ids = { ids: readonly NodeId[] };

const JUSTIFY = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];
const ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'];

// --- Layout ------------------------------------------------------------------------------------

export function LayoutSection({ ids }: Ids) {
  const doc = useEditor((s) => s.doc);
  const allRoots = ids.every((id) => isRoot(doc, id));
  const anyRoot = ids.some((id) => isRoot(doc, id));
  const free = !anyRoot && ids.every((id) => isOutOfFlow(domElement(id)));
  const containers = ids.every((id) => {
    const el = getElement(doc, id);
    return el && elementSpec(el.tag).acceptsChildren;
  });
  const declaredDisplay = useDeclared(ids, 'display');
  const display = declaredDisplay === MIXED ? '' : declaredDisplay || computedValue(ids[0], 'display');
  const mode = display.includes('flex') ? 'flex' : display.includes('grid') ? 'grid' : 'block';
  const direction = useDeclared(ids, 'flex-direction');
  const clipped = useDeclared(ids, 'overflow') === 'hidden';
  const singleRoot = allRoots && ids.length === 1 ? ids[0]! : null;

  return (
    <Section
      title={
        anyRoot ? (
          'Layout'
        ) : (
          <PositionMenu free={free} onChange={(next) => setFreePositioning(ids, next)} />
        )
      }
    >
      <Row>
        {singleRoot ? (
          <FramePosition id={singleRoot} />
        ) : free ? (
          <>
            <CssInput ids={ids} prop="left" prefix="X" numeric />
            <CssInput ids={ids} prop="top" prefix="Y" numeric />
          </>
        ) : (
          <>
            <FlowOffset ids={ids} axis="x" />
            <FlowOffset ids={ids} axis="y" />
          </>
        )}
        <RotationInput ids={ids} />
      </Row>
      <Row>
        <CssInput ids={ids} prop="width" prefix="W" numeric />
        <CssInput ids={ids} prop={allRoots ? 'min-height' : 'height'} prefix="H" numeric />
        <TransformButtons ids={ids} />
      </Row>

      {containers && mode !== 'block' ? (
        <>
          <Row>
            <Segmented
              ariaLabel="Layout"
              value={mode === 'grid' ? 'grid' : direction.startsWith('column') ? 'column' : 'row'}
              choices={[
                { value: 'row', label: <ArrowRight size={13} />, title: 'Flex row' },
                { value: 'column', label: <ArrowDown size={13} />, title: 'Flex column' },
                { value: 'grid', label: <LayoutGrid size={12} />, title: 'Grid' },
              ]}
              onChange={(v) =>
                useEditor.getState().apply('Set layout', (d) =>
                  v === 'grid'
                    ? setStyleOnNodes(setStyleOnNodes(d, ids, 'display', 'grid'), ids, 'grid-template-columns', 'repeat(2, minmax(0, 1fr))')
                    : setStyleOnNodes(setStyleOnNodes(d, ids, 'display', 'flex'), ids, 'flex-direction', v),
                )
              }
            />
            <button
              type="button"
              className="icon-button"
              title="Remove flex (back to block)"
              aria-label="Remove flex"
              onClick={() => clearStyles(ids, ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns'], 'Remove flex')}
            >
              <X size={12} />
            </button>
          </Row>
          {mode === 'flex' ? (
            <Row>
              <CssSelect ids={ids} prop="justify-content" label="Justify" options={JUSTIFY} />
              <CssSelect ids={ids} prop="align-items" label="Align" options={ALIGN} />
            </Row>
          ) : (
            <Row>
              <CssInput ids={ids} prop="grid-template-columns" prefix="Cols" mono />
            </Row>
          )}
          <Row>
            <CssInput ids={ids} prop="gap" prefix="Gap" numeric />
            <CssInput ids={ids} prop="padding" prefix="Pad" />
          </Row>
        </>
      ) : (
        (containers || ids.length > 1) && (
          <Row>
            <button type="button" className="insp-button" onClick={addFlexOrWrap}>
              {containers && ids.length === 1 ? 'Add flex' : 'Wrap in flex'} <span className="insp-kbd">⇧ A</span>
            </button>
          </Row>
        )
      )}

      <FlexChildRow ids={ids} />

      <div className="insp-row insp-row-check">
        <Checkbox checked={clipped} onChange={(on) => setStyle(ids, 'overflow', on ? 'hidden' : '')} label="Clip content" hint="⌥ C" />
      </div>
    </Section>
  );
}

/** "Layout ⌄": how the element is positioned — in its parent's flow, or freely (absolute). */
function PositionMenu({ free, onChange }: { free: boolean; onChange(free: boolean): void }) {
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
  const options = [
    { free: false, label: 'In flow', hint: 'Positioned by its parent’s layout' },
    { free: true, label: 'Free position', hint: 'position: absolute' },
  ];
  return (
    <span className="insp-menu-anchor" ref={ref}>
      <button type="button" className="insp-title-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Layout
        <ChevronDown size={12} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="insp-menu insp-menu-left" role="menu">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitemradio"
              aria-checked={o.free === free}
              className="insp-menu-item"
              title={o.hint}
              onClick={() => {
                if (o.free !== free) onChange(o.free);
                setOpen(false);
              }}
            >
              <span className="insp-menu-check">{o.free === free && <Check size={12} strokeWidth={2} />}</span>
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function FramePosition({ id }: { id: NodeId }) {
  const frame = useEditor((s) => s.doc.frames[id] ?? { x: 0, y: 0 });
  const set = (axis: 'x' | 'y', v: string) => {
    const n = parseFloat(v);
    if (Number.isFinite(n)) useEditor.getState().apply('Move frame', (d) => setFrame(d, id, { ...frame, [axis]: n }), { coalesce: `frame:${id}` });
  };
  return (
    <>
      <TextInput prefix="X" value={String(frame.x)} onChange={(v) => set('x', v)} ariaLabel="Canvas X" />
      <TextInput prefix="Y" value={String(frame.y)} onChange={(v) => set('y', v)} ariaLabel="Canvas Y" />
    </>
  );
}

/**
 * X/Y of an element in flow is decided by its parent's layout, not by CSS on the element, so
 * the measured offset is shown read-only. Switching to Free position makes it editable.
 */
function FlowOffset({ ids, axis }: Ids & { axis: 'x' | 'y' }) {
  const el = ids.length === 1 ? domElement(ids[0]) : null;
  const value = el ? String(Math.round(axis === 'x' ? el.offsetLeft : el.offsetTop)) : '';
  return (
    <span className="insp-field" title="Set by the parent's layout. Choose Layout ⌄ Free position to move it freely.">
      <input className="insp-input has-prefix is-readonly" aria-label={`${axis.toUpperCase()} (from layout)`} value={value} readOnly tabIndex={-1} />
      <span className="insp-prefix">{axis.toUpperCase()}</span>
    </span>
  );
}

/** CSS `rotate`, shown in degrees. */
function RotationInput({ ids }: Ids) {
  const declared = useDeclared(ids, 'rotate');
  const mixed = declared === MIXED;
  const degrees = mixed ? '' : /^(-?\d*\.?\d+)deg$/.exec(declared)?.[1] ?? (declared && declared !== 'none' ? declared : '');
  return (
    <TextInput
      ariaLabel="Rotation"
      prefix={<Angle size={14} strokeWidth={1.5} />}
      value={degrees ? `${degrees}°` : ''}
      placeholder={mixed ? 'Mixed' : '0°'}
      onChange={(v) => {
        const n = parseFloat(v);
        setStyle(ids, 'rotate', Number.isFinite(n) && n !== 0 ? `${n}deg` : '');
      }}
    />
  );
}

/** CSS `scale`: "" / "none" → 1 1, "2" → 2 2, "-1 1" → -1 1. */
export function parseScale(value: string): [number, number] {
  const parts = value.trim() === '' || value.trim() === 'none' ? [] : value.trim().split(/\s+/).map(Number);
  const sx = parts[0] !== undefined && Number.isFinite(parts[0]) ? parts[0] : 1;
  const sy = parts[1] !== undefined && Number.isFinite(parts[1]) ? parts[1] : sx;
  return [sx, sy];
}

/** Rotate 90° and flip, written as the CSS `rotate` and `scale` properties. */
function TransformButtons({ ids }: Ids) {
  const rotate = useDeclared(ids, 'rotate');
  const scale = useDeclared(ids, 'scale');
  const rotateBy90 = () => {
    const current = parseFloat(rotate === MIXED ? '0' : rotate) || 0;
    const next = (current + 90) % 360;
    setStyle(ids, 'rotate', next ? `${next}deg` : '');
  };
  const flip = (axis: 0 | 1) => {
    const [sx, sy] = parseScale(scale === MIXED ? '' : scale);
    const next: [number, number] = axis === 0 ? [-sx, sy] : [sx, -sy];
    setStyle(ids, 'scale', next[0] === 1 && next[1] === 1 ? '' : `${next[0]} ${next[1]}`);
  };
  return (
    <div className="insp-iconbar" role="group" aria-label="Transform">
      <button type="button" title="Rotate 90°" aria-label="Rotate 90 degrees" onClick={rotateBy90}>
        <RotateCwSquare size={14} strokeWidth={1.5} />
      </button>
      <button type="button" title="Flip horizontal" aria-label="Flip horizontal" onClick={() => flip(0)}>
        <FlipHorizontal2 size={14} strokeWidth={1.5} />
      </button>
      <button type="button" title="Flip vertical" aria-label="Flip vertical" onClick={() => flip(1)}>
        <FlipVertical2 size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

/** Controls that only make sense because of the parent's layout (flex/grid item). */
function FlexChildRow({ ids }: Ids) {
  const doc = useEditor((s) => s.doc);
  const parents = new Set(ids.map((id) => getParentId(doc, id)));
  const parentEl = domElement(parents.size === 1 ? [...parents][0] : null);
  if (!parentEl || ids.some((id) => isOutOfFlow(domElement(id)))) return null;
  const display = styleOf(parentEl).display;
  if (display.includes('flex')) {
    return (
      <Row>
        <CssInput ids={ids} prop="flex" prefix="Flex" placeholder="0 1 auto" />
        <CssSelect ids={ids} prop="align-self" label="Self" options={['auto', ...ALIGN]} />
      </Row>
    );
  }
  if (display.includes('grid')) {
    return (
      <Row>
        <CssInput ids={ids} prop="grid-column" prefix="Col" placeholder="auto" />
        <CssInput ids={ids} prop="grid-row" prefix="Row" placeholder="auto" />
      </Row>
    );
  }
  return null;
}

// --- Radius / Opacity --------------------------------------------------------------------------

export function RadiusSection({ ids }: Ids) {
  return (
    <Section title="Radius">
      <Row>
        <CssSlider ids={ids} prop="border-radius" min={0} max={48} label="Radius" />
        <span className="insp-narrow">
          <CssInput ids={ids} prop="border-radius" numeric />
        </span>
      </Row>
    </Section>
  );
}

export function OpacitySection({ ids }: Ids) {
  const declared = useDeclared(ids, 'opacity');
  const value = declared === MIXED ? '' : declared;
  const percent = value === '' ? '' : String(Math.round(parseFloat(value) * 100));
  return (
    <Section title="Opacity">
      <Row>
        <CssSlider ids={ids} prop="opacity" min={0} max={100} unit="" scale={100} label="Opacity" />
        <span className="insp-narrow">
          <TokenSlot ids={ids} prop="opacity">
          <TextInput
            ariaLabel="Opacity percent"
            suffix="%"
            value={percent}
            placeholder={declared === MIXED ? 'Mixed' : '100'}
            onChange={(v) => {
              const n = parseFloat(v);
              setStyle(ids, 'opacity', v.trim() === '' || !Number.isFinite(n) ? '' : String(Math.max(0, Math.min(100, n)) / 100));
            }}
          />
          </TokenSlot>
        </span>
      </Row>
    </Section>
  );
}

// --- Optional sections (+ / −) -----------------------------------------------------------------

/** A section that is collapsed until one of its props is set, or the user presses +. */
function OptionalSection({ ids, title, props, onAdd, aside, children }: Ids & { title: string; props: readonly string[]; onAdd?(): void; aside?: React.ReactNode; children: React.ReactNode }) {
  const declared = useAnyDeclared(ids, props);
  const [opened, setOpened] = useState(false);
  const open = declared || opened;
  return (
    <Section
      title={title}
      empty={!open}
      aside={open ? aside : undefined}
      onAdd={() => {
        setOpened(true);
        onAdd?.();
      }}
      onRemove={() => {
        setOpened(false);
        if (declared) clearStyles(ids, props, `Remove ${title.toLowerCase()}`);
      }}
    >
      {children}
    </Section>
  );
}

export function FillSection({ ids }: Ids) {
  const declared = useDeclared(ids, 'background');
  const gradient = declared && declared !== MIXED ? parseCssGradient(declared) : null;
  const image = declared && declared !== MIXED && /url\(/i.test(declared);
  const computed = computedValue(ids[0], 'background-color');
  const setType = (type: string) => {
    if (type === 'solid') {
      const first = gradient?.stops[0];
      setStyle(ids, 'background', first ? colorWithAlpha(first.color, first.alpha) : '#ffffff');
      return;
    }
    const base = gradient?.stops[0] ?? parseColor(declared && declared !== MIXED ? declared : computed) ?? { color: '#d9d9d9', alpha: 1 };
    const next = gradient ? { ...gradient, type: type as 'linear' | 'radial' } : gradientFrom(base.color, base.alpha || 1, type as 'linear' | 'radial');
    setStyle(ids, 'background', cssGradient(next));
  };
  return (
    <OptionalSection ids={ids} title="Fill" props={['background', 'background-color', 'background-image']} onAdd={() => setStyle(ids, 'background', '#ffffff')}>
      {!image && declared !== MIXED && (
        <Row>
          <Segmented
            ariaLabel="Fill type"
            value={gradient ? gradient.type : 'solid'}
            choices={[
              { value: 'solid', label: 'Solid' },
              { value: 'linear', label: 'Linear' },
              { value: 'radial', label: 'Radial' },
            ]}
            onChange={setType}
          />
        </Row>
      )}
      {gradient ? (
        <GradientEditor gradient={gradient} onChange={(g) => setStyle(ids, 'background', cssGradient(g))} />
      ) : (
        <Row>
          <ColorInput ids={ids} prop="background" computedProp="background-color" />
        </Row>
      )}
    </OptionalSection>
  );
}

const FONT_FAMILIES: readonly { value: string; label: string }[] = [
  { value: 'system-ui, sans-serif', label: 'System Sans-Serif' },
  { value: 'ui-serif, Georgia, serif', label: 'System Serif' },
  { value: 'ui-monospace, Menlo, monospace', label: 'System Mono' },
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Courier New", monospace', label: 'Courier New' },
];

const FONT_WEIGHTS: readonly { value: string; label: string }[] = [
  { value: '100', label: 'Thin' },
  { value: '200', label: 'Extra Light' },
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra Bold' },
  { value: '900', label: 'Black' },
];

const TEXT_PROPS = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'align-content'];
const TEXT_EXTRA_PROPS = ['color', 'text-decoration', 'text-decoration-line', 'text-transform'];

/** "Inter, system-ui, sans-serif" → "Inter"; known stacks get their friendly name. */
/** Tokens of a kind as select options: value var(--name), labelled by name. */
function useTokenOptions(kind: TokenKind): { value: string; label: string }[] {
  const values = useEditor((s) => s.doc.tokens.values);
  return Object.keys(values)
    .filter((n) => tokenKind(n) === kind)
    .map((n) => ({ value: tokenVar(n), label: `◇ ${n}` }));
}

function familyLabel(value: string): string {
  const ref = tokenReference(value);
  if (ref) return `◇ ${ref}`;
  const known = FONT_FAMILIES.find((f) => f.value === value);
  if (known) return known.label;
  const first = value.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
  if (first === 'system-ui' || first === '-apple-system') return 'System Sans-Serif';
  return first || value;
}

function weightLabel(value: string): string {
  const ref = tokenReference(value);
  if (ref) return `◇ ${ref}`;
  return FONT_WEIGHTS.find((w) => w.value === value)?.label ?? value;
}

function FontFamilySelect({ ids }: Ids) {
  const declared = useDeclared(ids, 'font-family');
  const computed = computedValue(ids[0], 'font-family');
  const tokens = useTokenOptions('font');
  const known = [...tokens, ...FONT_FAMILIES];
  const options = declared && declared !== MIXED && !known.some((f) => f.value === declared) ? [{ value: declared, label: familyLabel(declared) }, ...known] : known;
  return (
    <Select
      ariaLabel="Font family"
      prefix={<Type size={14} strokeWidth={1.5} />}
      value={declared === MIXED ? '' : declared}
      placeholder={declared === MIXED ? 'Mixed' : computed ? `${familyLabel(computed)} (inherited)` : 'Inherited'}
      options={options}
      onChange={(v) => setStyle(ids, 'font-family', v)}
    />
  );
}

/** Flags a font family that isn't installed here (common after a Figma import). */
function MissingFontNote({ ids }: Ids) {
  const declared = useDeclared(ids, 'font-family');
  const tokens = useEditor((s) => s.doc.tokens.values);
  const value = declared && declared !== MIXED ? declared : computedValue(ids[0], 'font-family');
  const missing = value ? missingFamily(value, tokens) : null;
  if (!missing) return null;
  const token = tokenReference(value);
  return (
    <div className="insp-font-missing" role="note">
      <TriangleAlert size={12} strokeWidth={1.75} />
      <span>
        <b>{missing}</b> isn’t installed; a fallback font is shown.{token ? ` Change --${token} in Theme to swap it everywhere.` : ''}
      </span>
    </div>
  );
}

function FontWeightSelect({ ids }: Ids) {
  const weightTokens = useTokenOptions('font-weight');
  const declared = useDeclared(ids, 'font-weight');
  const computed = computedValue(ids[0], 'font-weight');
  return (
    <Select
      ariaLabel="Font weight"
      prefix={<Bold size={14} strokeWidth={1.5} />}
      value={declared === MIXED ? '' : declared}
      placeholder={declared === MIXED ? 'Mixed' : computed ? `${weightLabel(computed)} (inherited)` : 'Inherited'}
      options={[...weightTokens, ...FONT_WEIGHTS]}
      onChange={(v) => setStyle(ids, 'font-weight', v)}
    />
  );
}

/** Line height: small bare numbers stay unitless multipliers (1.5); larger ones are px (20). */
function LineHeightInput({ ids }: Ids) {
  const declared = useDeclared(ids, 'line-height');
  const computed = computedValue(ids[0], 'line-height');
  const shown = declared === MIXED ? '' : declared.replace(/^(-?\d*\.?\d+)px$/, '$1');
  return (
    <TokenSlot ids={ids} prop="line-height">
    <TextInput
      ariaLabel="Line height"
      prefix={<Baseline size={14} strokeWidth={1.5} />}
      value={shown}
      placeholder={declared === MIXED ? 'Mixed' : computed === 'normal' ? 'Auto' : String(Math.round(parseFloat(computed) || 0) || '')}
      onChange={(v) => {
        const t = v.trim();
        const n = Number(t);
        setStyle(ids, 'line-height', t !== '' && Number.isFinite(n) && n > 4 ? `${n}px` : t);
      }}
    />
    </TokenSlot>
  );
}

/** Letter spacing as a percentage of the font size, stored as em (2% = 0.02em). */
function LetterSpacingInput({ ids }: Ids) {
  const declared = useDeclared(ids, 'letter-spacing');
  const em = /^(-?\d*\.?\d+)em$/.exec(declared === MIXED ? '' : declared);
  const shown = declared === MIXED ? '' : em ? `${Math.round(parseFloat(em[1]!) * 1000) / 10}%` : declared;
  return (
    <TokenSlot ids={ids} prop="letter-spacing">
    <TextInput
      ariaLabel="Letter spacing"
      prefix={<Space size={14} strokeWidth={1.5} />}
      value={shown}
      placeholder={declared === MIXED ? 'Mixed' : '0%'}
      onChange={(v) => {
        const t = v.trim();
        const n = parseFloat(t);
        if (t === '' || (Number.isFinite(n) && n === 0 && !/[a-z]/i.test(t))) setStyle(ids, 'letter-spacing', '');
        else if (/^-?\d*\.?\d+%?$/.test(t)) setStyle(ids, 'letter-spacing', `${n / 100}em`);
        else setStyle(ids, 'letter-spacing', t);
      }}
    />
    </TokenSlot>
  );
}

/** A segmented control where an unset value shows as the CSS initial behavior (e.g. left, top). */
function TextSegmented({ ids, prop, label, choices, fallback }: Ids & { prop: string; label: string; choices: readonly Choice[]; fallback: string }) {
  const declared = useDeclared(ids, prop);
  const value = declared === MIXED ? '' : declared || fallback;
  return <Segmented ariaLabel={label} value={value} choices={choices} onChange={(v) => setStyle(ids, prop, v === fallback && !declared ? '' : v)} />;
}

export function TextSection({ ids, textual }: Ids & { textual: boolean }) {
  const extrasDeclared = useAnyDeclared(ids, TEXT_EXTRA_PROPS);
  const [showExtras, setShowExtras] = useState(false);
  const extrasOpen = showExtras || extrasDeclared;
  const settings = (
    <button
      type="button"
      className={`icon-button${extrasOpen ? ' is-on' : ''}`}
      title="More text settings: color, decoration, case"
      aria-label="More text settings"
      aria-pressed={extrasOpen}
      onClick={() => setShowExtras(!showExtras)}
    >
      <SlidersVertical size={13} strokeWidth={1.5} />
    </button>
  );
  const body = (
    <>
      <Row>
        <FontFamilySelect ids={ids} />
      </Row>
      <MissingFontNote ids={ids} />
      <Row>
        <FontWeightSelect ids={ids} />
      </Row>
      <Row>
        <CssInput ids={ids} prop="font-size" prefix={<ALargeSmall size={14} strokeWidth={1.5} />} numeric />
        <LineHeightInput ids={ids} />
        <LetterSpacingInput ids={ids} />
      </Row>
      <Row>
        <TextSegmented
          ids={ids}
          prop="text-align"
          label="Horizontal alignment"
          fallback="left"
          choices={[
            { value: 'left', label: <TextAlignStart size={15} strokeWidth={1.5} />, title: 'Align left' },
            { value: 'center', label: <TextAlignCenter size={15} strokeWidth={1.5} />, title: 'Align center' },
            { value: 'right', label: <TextAlignEnd size={15} strokeWidth={1.5} />, title: 'Align right' },
          ]}
        />
        <TextSegmented
          ids={ids}
          prop="align-content"
          label="Vertical alignment"
          fallback="start"
          choices={[
            { value: 'start', label: <ArrowUpToLine size={14} strokeWidth={1.5} />, title: 'Top (align-content: start)' },
            { value: 'center', label: <FoldVertical size={14} strokeWidth={1.5} />, title: 'Middle (align-content: center)' },
            { value: 'end', label: <ArrowDownToLine size={14} strokeWidth={1.5} />, title: 'Bottom (align-content: end)' },
          ]}
        />
      </Row>
      {extrasOpen && (
        <>
          <Row>
            <ColorInput ids={ids} prop="color" />
          </Row>
          <Row>
            <TextSegmented
              ids={ids}
              prop="text-decoration-line"
              label="Decoration"
              fallback="none"
              choices={[
                { value: 'none', label: <X size={13} strokeWidth={1.5} />, title: 'No decoration' },
                { value: 'underline', label: <Underline size={13} strokeWidth={1.5} />, title: 'Underline' },
                { value: 'line-through', label: <Strikethrough size={13} strokeWidth={1.5} />, title: 'Strikethrough' },
              ]}
            />
            <TextSegmented
              ids={ids}
              prop="text-transform"
              label="Case"
              fallback="none"
              choices={[
                { value: 'none', label: <X size={13} strokeWidth={1.5} />, title: 'As typed' },
                { value: 'uppercase', label: 'AA', title: 'Uppercase' },
                { value: 'lowercase', label: 'aa', title: 'Lowercase' },
                { value: 'capitalize', label: 'Aa', title: 'Capitalize' },
              ]}
            />
          </Row>
        </>
      )}
    </>
  );
  // Text elements always show typography; containers only once something is set (it inherits).
  if (textual) {
    return (
      <Section title="Text" aside={settings}>
        {body}
      </Section>
    );
  }
  return (
    <OptionalSection ids={ids} title="Text" props={[...TEXT_PROPS, ...TEXT_EXTRA_PROPS]} aside={settings}>
      {body}
    </OptionalSection>
  );
}

export function BorderSection({ ids }: Ids) {
  return (
    <OptionalSection ids={ids} title="Border" props={['border', 'border-width', 'border-style', 'border-color']} onAdd={() => setStyle(ids, 'border', '1px solid #d1d5db')}>
      <Row>
        <CssInput ids={ids} prop="border" placeholder="1px solid #d1d5db" />
      </Row>
    </OptionalSection>
  );
}

export function ShadowSection({ ids }: Ids) {
  return (
    <OptionalSection ids={ids} title="Shadow" props={['box-shadow']} onAdd={() => setStyle(ids, 'box-shadow', '0 1px 3px rgb(0 0 0 / 0.12)')}>
      <Row>
        <CssInput ids={ids} prop="box-shadow" placeholder="0 1px 3px rgb(0 0 0 / 0.12)" />
      </Row>
    </OptionalSection>
  );
}

export function MarginSection({ ids }: Ids) {
  return (
    <OptionalSection ids={ids} title="Margin" props={['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']}>
      <Row>
        <CssInput ids={ids} prop="margin" placeholder="0" />
      </Row>
    </OptionalSection>
  );
}

export function ConstraintsSection({ ids }: Ids) {
  return (
    <OptionalSection ids={ids} title="Min / max size" props={['min-width', 'max-width', 'min-height', 'max-height']}>
      <Row>
        <CssInput ids={ids} prop="min-width" prefix="Min W" numeric />
        <CssInput ids={ids} prop="max-width" prefix="Max W" numeric />
      </Row>
      <Row>
        <CssInput ids={ids} prop="min-height" prefix="Min H" numeric />
        <CssInput ids={ids} prop="max-height" prefix="Max H" numeric />
      </Row>
    </OptionalSection>
  );
}

// --- All CSS -----------------------------------------------------------------------------------

/** Every declaration on the primary class: the escape hatch to all of CSS. */
export function CssSection({ el }: { el: ElementNode }) {
  const rule = useEditor((s) => (el.classes[0] ? s.doc.styles.rules[el.classes[0]] : undefined));
  const [open, setOpen] = useState(false);
  const [prop, setProp] = useState('');
  const cls = el.classes[0];
  const ids = [el.id];
  const count = Object.keys(rule ?? {}).length;
  return (
    <Section
      title={
        <button type="button" className="insp-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
          CSS{cls ? <code>.{cls}</code> : null}
          <span className="insp-count">{count}</span>
        </button>
      }
      empty={!open}
    >
      {Object.entries(rule ?? {}).map(([p, v]) => (
        <div key={p} className="insp-row insp-raw">
          <code className="insp-raw-key">{p}</code>
          <TextInput mono value={v} ariaLabel={p} onChange={(value) => setStyle(ids, p, value)} />
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${p}`}
            onClick={() => cls && useEditor.getState().apply(`Remove ${p}`, (d) => setDeclaration(d, cls, p, null))}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="insp-row">
        <input
          className="insp-input is-mono"
          placeholder="property: value"
          aria-label="New CSS declaration"
          value={prop}
          spellCheck={false}
          onChange={(e) => setProp(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const [name, ...rest] = prop.split(':');
            const p = name!.trim().toLowerCase();
            if (!/^-?-?[a-z][a-z0-9-]*$/.test(p)) return;
            setStyle(ids, p, rest.join(':').trim().replace(/;$/, '') || 'initial');
            setProp('');
          }}
        />
      </div>
    </Section>
  );
}
