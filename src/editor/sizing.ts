/** Sizing intents write ordinary CSS, without editor-only layout metadata. */
import { setStyleOnNodes } from '../document/ops.ts';
import type { DesignDocument, NodeId } from '../document/types.ts';
export type SizeMode = 'fixed' | 'fit' | 'fill' | 'relative';
export type SizeAxis = 'width' | 'height';
export interface SizeContext {
  parent?: NodeId;
  main: boolean;
  flex: boolean;
  measured: number;
  parentMeasured: number;
  parentFit: boolean;
  legacyMinHeight?: boolean;
}
export function sizeMode(value: string, context: Pick<SizeContext, 'main' | 'flex'>, grow = '0', alignSelf = ''): SizeMode {
  if (context.flex && context.main && parseFloat(grow) > 0) return 'fill';
  if (context.flex && !context.main && alignSelf === 'stretch' && (!value || value === 'auto')) return 'fill';
  if (value === '100%') return 'fill';
  if (value.endsWith('%')) return 'relative';
  if (!value || ['auto', 'max-content', 'min-content', 'fit-content'].includes(value)) return 'fit';
  return 'fixed';
}
export function setSize(doc: DesignDocument, id: NodeId, axis: SizeAxis, mode: SizeMode, context: SizeContext, value?: string): DesignDocument {
  if ((mode === 'fill' || mode === 'relative') && !context.parent) return doc;
  const write = (prop: string, v: string | null) => { doc = setStyleOnNodes(doc, [id], prop, v); };
  if (axis === 'height' && context.legacyMinHeight) write('min-height', null);
  if (context.flex && context.main) {
    // Override all longhands, including imported flex shorthands.
    write('flex', mode === 'fill' ? '1 1 0px' : '0 0 auto');
    for (const prop of ['flex-grow', 'flex-shrink', 'flex-basis']) write(prop, null);
    write(`min-${axis}`, mode === 'fill' ? '0px' : null);
  } else if (context.flex) {
    write('align-self', mode === 'fill' ? 'stretch' : 'flex-start');
  }
  if (mode === 'fill' && context.parentFit) {
    // A child cannot fill an intrinsic parent on the same axis: freeze its current size.
    doc = setStyleOnNodes(doc, [context.parent!], axis, `${Math.max(1, context.parentMeasured)}px`);
    if (axis === 'height') doc = setStyleOnNodes(doc, [context.parent!], 'min-height', null);
  }
  const dimension = mode === 'fit' ? 'max-content' : mode === 'fill' ? (context.flex ? 'auto' : '100%')
    : mode === 'relative' ? value ?? `${Math.round(context.measured / Math.max(1, context.parentMeasured) * 10000) / 100}%`
    : value ?? `${Math.round(context.measured * 100) / 100}px`;
  write(axis, dimension);
  return doc;
}
