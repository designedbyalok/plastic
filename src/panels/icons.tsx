import {
  AlignLeft, Box, Code, Columns3, Frame, Heading, Image, Link, List, MousePointer2, RectangleHorizontal, Rows3,
  Square, SquareCheck, SquareChevronDown, Table, TextCursorInput, FormInput, Type, type LucideIcon,
} from 'lucide-react';
import type { ElementNode } from '../document/types.ts';
import { elementSpec } from '../elements/registry.ts';

export const INSERT_ICONS: Record<string, LucideIcon> = {
  container: Square,
  heading: Heading,
  text: Type,
  button: RectangleHorizontal,
  link: Link,
  input: TextCursorInput,
  field: FormInput,
  textarea: AlignLeft,
  select: SquareChevronDown,
  checkbox: SquareCheck,
  image: Image,
  table: Table,
  list: List,
};

export const TOOL_ICONS = { select: MousePointer2, frame: Frame, code: Code };

/** Icon for a layer row, chosen from semantics (and flex direction for stacks). */
export function iconFor(el: ElementNode, direction?: string): LucideIcon {
  if (el.tag === 'input') return el.attrs.type === 'checkbox' || el.attrs.type === 'radio' ? SquareCheck : TextCursorInput;
  const map: Record<string, LucideIcon> = {
    button: RectangleHorizontal, a: Link, img: Image, table: Table, select: SquareChevronDown, textarea: AlignLeft,
    ul: List, ol: List, label: FormInput, form: FormInput,
  };
  if (map[el.tag]) return map[el.tag]!;
  if (/^h[1-6]$/.test(el.tag)) return Heading;
  const category = elementSpec(el.tag).category;
  if (category === 'text') return Type;
  if (direction?.startsWith('row')) return Columns3;
  if (direction?.startsWith('column')) return Rows3;
  return category === 'container' ? Frame : Box;
}
