/**
 * Path geometry operations on SVG path data, via Paper.js (MIT) and paperjs-offset (MIT).
 * Both load on first use, so they cost nothing until someone runs an operation.
 */
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

type Paper = paper.PaperScope;
let loading: Promise<{ paper: Paper; offsetStroke: (path: never, distance: number, options?: object) => unknown }> | null = null;

function load() {
  loading ??= (async () => {
    const [module, offset] = await Promise.all([import('paper'), import('paperjs-offset')]);
    const paper = ((module as unknown as { default?: Paper }).default ?? module) as Paper;
    // A tiny project; nothing is drawn, Paper only does the geometry.
    paper.setup(new paper.Size(1, 1));
    return { paper, offsetStroke: offset.offsetStroke as never };
  })();
  return loading;
}

function item(paper: Paper, d: string) {
  return new paper.CompoundPath({ pathData: d, insert: false });
}

/**
 * Combine shapes in order: the first is the bottom-most. Subtract removes every later shape from
 * the first; the others fold left to right, like Figma.
 */
export async function booleanPaths(op: BooleanOp, paths: readonly string[]): Promise<string> {
  const { paper } = await load();
  const [first, ...rest] = paths.map((d) => item(paper, d));
  if (!first) return '';
  let result: paper.PathItem = first;
  for (const next of rest) {
    const method = op === 'union' ? 'unite' : op;
    result = result[method](next, { insert: false });
  }
  return result.pathData;
}

/** A stroke as a filled outline: the area the stroke paints. */
export async function outlineStroke(d: string, width: number, join: string, cap: string): Promise<string> {
  const { paper, offsetStroke } = await load();
  const source = item(paper, d);
  const outline = offsetStroke(source as never, width / 2, { join: join === 'bevel' ? 'bevel' : join === 'round' ? 'round' : 'miter', cap: cap === 'round' ? 'round' : 'butt', insert: false }) as paper.PathItem;
  return outline.pathData;
}

/** Bounds of path data (for fitting the result's box). */
export async function pathBounds(d: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const { paper } = await load();
  const b = item(paper, d).bounds;
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}
