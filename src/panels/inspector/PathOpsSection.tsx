/** Union, Subtract, Intersect, Exclude, Flatten and Outline stroke for the selection (Figma's). */
import { Combine, PenLine, SquaresExclude, SquaresIntersect, SquaresSubtract, SquaresUnite, type LucideIcon } from 'lucide-react';
import { useEditor } from '../../editor/store.ts';
import { pathOpsFor, runOutlineStroke, runPathOp, type PathOp } from '../../vector/pathOps.ts';
import { Section } from './fields.tsx';

const BOOLEANS: readonly { op: PathOp; label: string; keys: string; icon: LucideIcon }[] = [
  { op: 'union', label: 'Union', keys: '⌥⇧U', icon: SquaresUnite },
  { op: 'subtract', label: 'Subtract', keys: '⌥⇧S', icon: SquaresSubtract },
  { op: 'intersect', label: 'Intersect', keys: '⌥⇧I', icon: SquaresIntersect },
  { op: 'exclude', label: 'Exclude', keys: '⌥⇧X', icon: SquaresExclude },
];

export function PathOpsSection({ ids }: { ids: readonly string[] }) {
  const doc = useEditor((s) => s.doc);
  const editing = useEditor((s) => !!s.vectorEdit);
  const can = pathOpsFor(doc, ids);
  if (editing || (!can.booleans && !can.flatten && !can.outline)) return null;
  return (
    <Section title="Path operations">
      <div className="insp-ops">
        {BOOLEANS.map(({ op, label, keys, icon: Icon }) => (
          <button
            key={op}
            type="button"
            className="insp-op"
            disabled={!can.booleans}
            title={can.booleans ? `${label}  ${keys}` : `${label}: select two or more shapes`}
            aria-label={label}
            onClick={() => void runPathOp(op)}
          >
            <Icon size={15} strokeWidth={1.5} />
          </button>
        ))}
        <span className="insp-ops-divider" />
        <button type="button" className="insp-op" disabled={!can.flatten} title={can.flatten ? 'Flatten  ⌘E' : 'Flatten: select shapes to combine'} aria-label="Flatten" onClick={() => void runPathOp('flatten')}>
          <Combine size={15} strokeWidth={1.5} />
        </button>
        <button type="button" className="insp-op" disabled={!can.outline} title={can.outline ? 'Outline stroke  ⌥⌘O' : 'Outline stroke: select a vector with a stroke'} aria-label="Outline stroke" onClick={() => void runOutlineStroke()}>
          <PenLine size={15} strokeWidth={1.5} />
        </button>
      </div>
    </Section>
  );
}
