/** Presentation sections. Every control writes a plain CSS declaration. */
import { ArrowDown, ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { domElement, isOutOfFlow } from '../../canvas/dom';
import { setDeclaration, setFrame } from '../../document/ops';
import { getElement, getParentId, isRoot } from '../../document/tree';
import type { ElementNode, NodeId } from '../../document/types';
import { elementSpec } from '../../elements/registry';
import { setFreePositioning } from '../../editor/commands';
import { useEditor } from '../../editor/store';
import { ColorField, CssField, CssSegmented, CssSelect, Grid, MIXED, Row, Section, Segmented, TextInput, computedValue, setStyle, useDeclared } from './fields';

type Ids = { ids: readonly NodeId[] };

export function PositionSection({ ids }: Ids) {
  const doc = useEditor((s) => s.doc);
  const roots = ids.filter((id) => isRoot(doc, id));
  if (roots.length === ids.length) {
    if (ids.length !== 1) return null;
    const id = ids[0]!;
    const frame = doc.frames[id] ?? { x: 0, y: 0 };
    const set = (axis: 'x' | 'y', v: string) => {
      const n = parseFloat(v);
      if (Number.isFinite(n)) useEditor.getState().apply('Move frame', (d) => setFrame(d, id, { ...frame, [axis]: n }), { coalesce: `frame:${id}` });
    };
    return (
      <Section title="Canvas">
        <Grid>
          <Row label="X" hint="Artboard position on the canvas (editor metadata, not CSS)">
            <TextInput value={String(frame.x)} onChange={(v) => set('x', v)} />
          </Row>
          <Row label="Y">
            <TextInput value={String(frame.y)} onChange={(v) => set('y', v)} />
          </Row>
        </Grid>
      </Section>
    );
  }
  if (roots.length) return null;
  const free = ids.every((id) => isOutOfFlow(domElement(id)));
  return (
    <Section title="Position">
      <Row label="Mode" hint="Free: position absolute (exploration). Layout: flows inside its parent's flex/grid/block layout.">
        <Segmented
          ariaLabel="Positioning"
          value={free ? 'free' : 'flow'}
          choices={[
            { value: 'flow', label: 'Layout', title: 'Flow in parent layout' },
            { value: 'free', label: 'Free', title: 'position: absolute' },
          ]}
          onChange={(v) => setFreePositioning(ids, v === 'free')}
        />
      </Row>
      {free && (
        <Grid>
          <CssField ids={ids} prop="left" label="Left" />
          <CssField ids={ids} prop="top" label="Top" />
          <CssField ids={ids} prop="right" label="Right" />
          <CssField ids={ids} prop="bottom" label="Bottom" />
          <CssField ids={ids} prop="z-index" label="Z" />
        </Grid>
      )}
    </Section>
  );
}

const JUSTIFY = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'];
const ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'];

export function LayoutSection({ ids }: Ids) {
  const doc = useEditor((s) => s.doc);
  const containers = ids.every((id) => {
    const el = getElement(doc, id);
    return el && elementSpec(el.tag).acceptsChildren;
  });
  const declaredDisplay = useDeclared(ids, 'display');
  if (!containers) return null;
  const display = declaredDisplay === MIXED ? '' : declaredDisplay || computedValue(ids[0], 'display');
  const mode = display.includes('flex') ? 'flex' : display.includes('grid') ? 'grid' : 'block';

  return (
    <Section title="Layout">
      <Row label="Display" hint="display">
        <Segmented
          ariaLabel="Display"
          value={mode}
          choices={[
            { value: 'block', label: 'Block' },
            { value: 'flex', label: 'Flex' },
            { value: 'grid', label: 'Grid' },
          ]}
          onChange={(v) => setStyle(ids, 'display', v === 'block' && !declaredDisplay ? '' : v)}
        />
      </Row>
      {mode === 'flex' && (
        <>
          <CssSegmented
            ids={ids}
            prop="flex-direction"
            label="Direction"
            choices={[
              { value: 'row', label: <ArrowRight size={13} />, title: 'Row (horizontal)' },
              { value: 'column', label: <ArrowDown size={13} />, title: 'Column (vertical)' },
            ]}
          />
          <CssSelect ids={ids} prop="justify-content" label="Justify" options={JUSTIFY} />
          <CssSelect ids={ids} prop="align-items" label="Align" options={ALIGN} />
          <Grid>
            <CssField ids={ids} prop="gap" label="Gap" />
            <CssSelect ids={ids} prop="flex-wrap" label="Wrap" options={['nowrap', 'wrap']} />
          </Grid>
        </>
      )}
      {mode === 'grid' && (
        <>
          <Row label="Columns" hint="grid-template-columns">
            <div className="stack-tight">
              <Segmented
                ariaLabel="Column count"
                value=""
                choices={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n), title: `${n} equal columns` }))}
                onChange={(n) => setStyle(ids, 'grid-template-columns', `repeat(${n}, minmax(0, 1fr))`)}
              />
              <CssFieldInline ids={ids} prop="grid-template-columns" />
            </div>
          </Row>
          <Grid>
            <CssField ids={ids} prop="gap" label="Gap" />
            <CssSelect ids={ids} prop="align-items" label="Align" options={['stretch', 'start', 'center', 'end']} />
          </Grid>
        </>
      )}
    </Section>
  );
}

function CssFieldInline({ ids, prop }: { ids: readonly NodeId[]; prop: string }) {
  const declared = useDeclared(ids, prop);
  return <TextInput mono value={declared === MIXED ? '' : declared} placeholder={computedValue(ids[0], prop)} onChange={(v) => setStyle(ids, prop, v)} />;
}

/** Controls that only make sense because of the parent's layout (flex/grid item). */
export function ChildLayoutSection({ ids }: Ids) {
  const doc = useEditor((s) => s.doc);
  const parents = new Set(ids.map((id) => getParentId(doc, id)));
  const parentId = parents.size === 1 ? [...parents][0] : null;
  const parentEl = domElement(parentId);
  if (!parentEl || ids.some((id) => isOutOfFlow(domElement(id)))) return null;
  const display = getComputedStyle(parentEl).display;
  if (display.includes('flex')) {
    return (
      <Section title="In flex parent">
        <Grid>
          <CssField ids={ids} prop="flex" label="Flex" placeholder="0 1 auto" />
          <CssSelect ids={ids} prop="align-self" label="Self" options={['auto', ...ALIGN]} />
        </Grid>
      </Section>
    );
  }
  if (display.includes('grid')) {
    return (
      <Section title="In grid parent">
        <Grid>
          <CssField ids={ids} prop="grid-column" label="Column" placeholder="auto" />
          <CssField ids={ids} prop="grid-row" label="Row" placeholder="auto" />
        </Grid>
      </Section>
    );
  }
  return null;
}

export function SizeSection({ ids }: Ids) {
  return (
    <Section title="Size">
      <Grid>
        <CssField ids={ids} prop="width" label="W" />
        <CssField ids={ids} prop="height" label="H" />
        <CssField ids={ids} prop="min-width" label="Min W" placeholder="—" />
        <CssField ids={ids} prop="min-height" label="Min H" placeholder="—" />
        <CssField ids={ids} prop="max-width" label="Max W" placeholder="—" />
        <CssField ids={ids} prop="max-height" label="Max H" placeholder="—" />
      </Grid>
    </Section>
  );
}

export function SpacingSection({ ids }: Ids) {
  return (
    <Section title="Spacing">
      <CssField ids={ids} prop="padding" label="Padding" />
      <CssField ids={ids} prop="margin" label="Margin" />
    </Section>
  );
}

export function AppearanceSection({ ids }: Ids) {
  return (
    <Section title="Appearance">
      <ColorField ids={ids} prop="background" label="Fill" />
      <CssField ids={ids} prop="border" label="Border" placeholder="1px solid #e5e7eb" />
      <Grid>
        <CssField ids={ids} prop="border-radius" label="Radius" />
        <CssField ids={ids} prop="opacity" label="Opacity" />
      </Grid>
      <CssField ids={ids} prop="box-shadow" label="Shadow" placeholder="0 1px 3px rgb(0 0 0 / 0.1)" />
      <CssSelect ids={ids} prop="overflow" label="Overflow" options={['visible', 'hidden', 'auto', 'clip']} />
    </Section>
  );
}

export function TypographySection({ ids }: Ids) {
  return (
    <Section title="Text">
      <ColorField ids={ids} prop="color" label="Color" />
      <CssField ids={ids} prop="font-family" label="Font" />
      <Grid>
        <CssField ids={ids} prop="font-size" label="Size" />
        <CssSelect ids={ids} prop="font-weight" label="Weight" options={['300', '400', '500', '600', '700', '800']} />
        <CssField ids={ids} prop="line-height" label="Line" />
        <CssField ids={ids} prop="letter-spacing" label="Tracking" />
      </Grid>
      <CssSegmented
        ids={ids}
        prop="text-align"
        label="Align"
        choices={['left', 'center', 'right', 'justify'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1, 3) }))}
      />
    </Section>
  );
}

/** Every declaration on the primary class: the escape hatch to all of CSS. */
export function CssSection({ el }: { el: ElementNode }) {
  const rule = useEditor((s) => (el.classes[0] ? s.doc.styles.rules[el.classes[0]] : undefined));
  const [prop, setProp] = useState('');
  const cls = el.classes[0];
  const ids = [el.id];
  return (
    <Section title={cls ? `CSS · .${cls}` : 'CSS'} defaultOpen={false}>
      {Object.entries(rule ?? {}).map(([p, v]) => (
        <div key={p} className="raw-row">
          <code className="raw-key">{p}</code>
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
      <div className="raw-row">
        <input
          className="text-input is-mono"
          placeholder="add property…  e.g. transition"
          aria-label="New CSS property"
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
