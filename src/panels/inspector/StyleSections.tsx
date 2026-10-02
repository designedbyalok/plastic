/**
 * Presentation sections, ordered like a design tool (Layout, Radius, Opacity, Fill…) but every
 * control writes a plain CSS declaration. Optional sections stay collapsed behind a + until
 * something is set, and − clears exactly the declarations that section owns.
 */
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight, LayoutGrid, X } from 'lucide-react';
import { useState } from 'react';
import { domElement, isOutOfFlow, styleOf } from '../../canvas/dom';
import { setDeclaration, setFrame, setStyleOnNodes } from '../../document/ops';
import { getElement, getParentId, isRoot } from '../../document/tree';
import type { ElementNode, NodeId } from '../../document/types';
import { elementSpec } from '../../elements/registry';
import { addFlexOrWrap, setFreePositioning } from '../../editor/commands';
import { useEditor } from '../../editor/store';
import {
  Checkbox, ColorInput, CssInput, CssSegmented, CssSelect, CssSlider, MIXED, Row, Section, Segmented, TextInput,
  clearStyles, computedValue, setStyle, useAnyDeclared, useDeclared,
} from './fields';

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


  return (
    <Section
      title="Layout"
      aside={
        !anyRoot ? (
          <Segmented
            ariaLabel="Positioning"
            value={free ? 'free' : 'flow'}
            choices={[
              { value: 'flow', label: 'Flow', title: 'Flows in its parent’s layout' },
              { value: 'free', label: 'Free', title: 'position: absolute' },
            ]}
            onChange={(v) => setFreePositioning(ids, v === 'free')}
          />
        ) : undefined
      }
    >
      {allRoots && ids.length === 1 && <FramePosition id={ids[0]!} />}
      {free && (
        <Row>
          <CssInput ids={ids} prop="left" prefix="X" numeric />
          <CssInput ids={ids} prop="top" prefix="Y" numeric />
        </Row>
      )}
      <Row>
        <CssInput ids={ids} prop="width" prefix="W" numeric />
        <CssInput ids={ids} prop={allRoots ? 'min-height' : 'height'} prefix="H" numeric />
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
              title="Remove layout (back to block)"
              aria-label="Remove layout"
              onClick={() => clearStyles(ids, ['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns'], 'Remove layout')}
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
        <>
          {(containers || ids.length > 1) && (
            <Row>
              <button type="button" className="insp-button" onClick={addFlexOrWrap}>
                {containers && ids.length === 1 ? 'Add flex' : 'Wrap in flex'} <span className="insp-kbd">⇧ A</span>
              </button>
            </Row>
          )}
          {containers && (
            <Row>
              <CssInput ids={ids} prop="padding" prefix="Pad" />
            </Row>
          )}
        </>
      )}

      <FlexChildRow ids={ids} />

      <Row>
        <Checkbox checked={clipped} onChange={(on) => setStyle(ids, 'overflow', on ? 'hidden' : '')} label="Clip content" />
      </Row>
    </Section>
  );
}

function FramePosition({ id }: { id: NodeId }) {
  const frame = useEditor((s) => s.doc.frames[id] ?? { x: 0, y: 0 });
  const set = (axis: 'x' | 'y', v: string) => {
    const n = parseFloat(v);
    if (Number.isFinite(n)) useEditor.getState().apply('Move frame', (d) => setFrame(d, id, { ...frame, [axis]: n }), { coalesce: `frame:${id}` });
  };
  return (
    <Row>
      <TextInput prefix="X" value={String(frame.x)} onChange={(v) => set('x', v)} ariaLabel="Canvas X" />
      <TextInput prefix="Y" value={String(frame.y)} onChange={(v) => set('y', v)} ariaLabel="Canvas Y" />
    </Row>
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
        </span>
      </Row>
    </Section>
  );
}

// --- Optional sections (+ / −) -----------------------------------------------------------------

/** A section that is collapsed until one of its props is set, or the user presses +. */
function OptionalSection({ ids, title, props, onAdd, children }: Ids & { title: string; props: readonly string[]; onAdd?(): void; children: React.ReactNode }) {
  const declared = useAnyDeclared(ids, props);
  const [opened, setOpened] = useState(false);
  const open = declared || opened;
  return (
    <Section
      title={title}
      empty={!open}
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
  return (
    <OptionalSection ids={ids} title="Fill" props={['background', 'background-color', 'background-image']} onAdd={() => setStyle(ids, 'background', '#ffffff')}>
      <Row>
        <ColorInput ids={ids} prop="background" computedProp="background-color" />
      </Row>
    </OptionalSection>
  );
}

const TEXT_PROPS = ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align'];

export function TextSection({ ids, textual }: Ids & { textual: boolean }) {
  const body = (
    <>
      <Row>
        <ColorInput ids={ids} prop="color" />
      </Row>
      <Row>
        <CssInput ids={ids} prop="font-family" placeholder="inherit" />
      </Row>
      <Row>
        <CssInput ids={ids} prop="font-size" prefix="Size" numeric />
        <CssSelect ids={ids} prop="font-weight" label="Weight" options={['300', '400', '500', '600', '700', '800']} />
      </Row>
      <Row>
        <CssInput ids={ids} prop="line-height" prefix="Line" />
        <CssInput ids={ids} prop="letter-spacing" prefix="Track" />
      </Row>
      <Row>
        <CssSegmented
          ids={ids}
          prop="text-align"
          label="Align"
          choices={[
            { value: 'left', label: <AlignLeft size={13} />, title: 'Align left' },
            { value: 'center', label: <AlignCenter size={13} />, title: 'Align center' },
            { value: 'right', label: <AlignRight size={13} />, title: 'Align right' },
            { value: 'justify', label: <AlignJustify size={13} />, title: 'Justify' },
          ]}
        />
      </Row>
    </>
  );
  // Text elements always show typography; containers only once something is set (it inherits).
  if (textual) return <Section title="Text" onRemove={undefined}>{body}</Section>;
  return (
    <OptionalSection ids={ids} title="Text" props={TEXT_PROPS}>
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
