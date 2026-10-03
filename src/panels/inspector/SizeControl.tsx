import { Check, ChevronDown } from 'lucide-react';
import { domElement, isOutOfFlow, styleOf } from '../../canvas/dom.ts';
import { getParentId } from '../../document/tree.ts';
import type { NodeId } from '../../document/types.ts';
import { setSize, sizeMode, type SizeAxis, type SizeContext, type SizeMode } from '../../editor/sizing.ts';
import { useEditor } from '../../editor/store.ts';
import { Menu, MenuContent } from '../ui/Menu.tsx';
import { declaredValue, stepValue, TextInput, TokenSlot } from './fields.tsx';

export function SizeControl({ ids, axis }: { ids: readonly NodeId[]; axis: SizeAxis }) {
  const doc = useEditor(s => s.doc);
  const values = ids.map(id => {
    const el = domElement(id); const cs = el ? styleOf(el) : null;
    const parent = getParentId(doc, id) ?? undefined;
    const parentEl = domElement(parent); const pcs = parentEl ? styleOf(parentEl) : null;
    const flex = !!(parent ? declaredValue(doc, [parent], 'display') || pcs?.display : pcs?.display)?.includes('flex') && !isOutOfFlow(el);
    const main = flex && ((parent ? declaredValue(doc, [parent], 'flex-direction') || pcs?.flexDirection || 'row' : 'row').startsWith('column') === (axis === 'height'));
    const declared = declaredValue(doc, [id], axis);
    const legacyMinHeight = !parent && axis === 'height' && !declared && !!declaredValue(doc, [id], 'min-height');
    const value = declared || (legacyMinHeight ? declaredValue(doc, [id], 'min-height') : '');
    const dimension = (node: HTMLElement | null) => node?.getBoundingClientRect()[axis] ?? 0;
    const parentValue = parent ? declaredValue(doc, [parent], axis) : '';
    const context: SizeContext = { parent, flex, main, measured: dimension(el), parentMeasured: dimension(parentEl),
      parentFit: ['max-content', 'fit-content', 'min-content'].includes(parentValue), legacyMinHeight };
    const grow = declaredValue(doc, [id], 'flex-grow') || declaredValue(doc, [id], 'flex').split(/\s+/)[0] || cs?.flexGrow || '0';
    return { id, value, context, mode: sizeMode(value, context, grow, declaredValue(doc, [id], 'align-self') || (cs?.alignSelf === 'auto' ? pcs?.alignItems : cs?.alignSelf)) };
  });
  const first = values[0]!;
  const mixed = values.some(v => v.mode !== first.mode || v.value !== first.value);
  const label = axis === 'width' ? 'Width' : 'Height';
  const shown = mixed ? '' : first.mode === 'fit' ? 'Fit' : first.mode === 'fill' ? 'Fill' : first.value.replace(/px$/, '');
  const apply = (mode: SizeMode, value?: string) => useEditor.getState().apply(`Set ${label} ${mode === 'fit' ? 'Fit' : mode === 'fill' ? 'Fill' : mode === 'relative' ? 'Relative' : 'Fixed'}`,
    d => values.reduce((next, v) => setSize(next, v.id, axis, mode, v.context, value), d), { coalesce: `size:${axis}:${ids.join(',')}` });
  return <span className="size-control">
    <TokenSlot ids={ids} prop={axis} prefix={axis === 'width' ? 'W' : 'H'}><TextInput ariaLabel={axis} prefix={axis === 'width' ? 'W' : 'H'} value={shown} onFocus={() => useEditor.setState({ styleSourceProperty: axis })} onKeyDown={(event, current) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const next = stepValue(current, `${first.context.measured}px`, event.key === 'ArrowUp' ? 1 : -1, event);
      if (next === null) return;
      event.preventDefault(); apply(next.endsWith('%') ? 'relative' : 'fixed', /^\d*\.?\d+$/.test(next) ? `${next}px` : next);
    }} placeholder={mixed ? 'Mixed' : ''}
      onChange={raw => {
        const v = raw.trim();
        if (/^fit$/i.test(v)) { apply('fit'); return; }
        if (/^fill$/i.test(v)) { apply('fill'); return; }
        if (!v || !CSS.supports(axis, /^\d*\.?\d+$/.test(v) ? `${v}px` : v)) return;
        apply(v.endsWith('%') ? 'relative' : 'fixed', /^\d*\.?\d+$/.test(v) ? `${v}px` : v);
      }} /></TokenSlot>
    <Menu.Root modal={false}><Menu.Trigger asChild><button type="button" className="size-mode-trigger" aria-label={`${label} Sizing`}><ChevronDown size={12} /></button></Menu.Trigger>
      <MenuContent aria-label={`${label} Sizing`}><Menu.RadioGroup value={mixed ? '' : first.mode}>
        {(['fixed', 'fit', 'fill', 'relative'] as const).map(mode => <Menu.RadioItem key={mode} value={mode} className="insp-menu-item" disabled={(mode === 'fill' || mode === 'relative') && values.some(v => !v.context.parent)} onSelect={() => apply(mode)}>
          <span className="insp-menu-check">{!mixed && mode === first.mode && <Check size={12} />}</span>{mode === 'fixed' ? 'Fixed' : mode === 'fit' ? 'Fit' : mode === 'fill' ? 'Fill' : 'Relative'}
        </Menu.RadioItem>)}
      </Menu.RadioGroup></MenuContent>
    </Menu.Root>
  </span>;
}
