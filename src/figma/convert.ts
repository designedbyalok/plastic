/**
 * Figma (.fig) → Plastic project.
 *
 * Reading the .fig format is OpenPencil's job (@open-pencil/core decodes the kiwi archive into a
 * scene graph, with component instances already expanded). This module maps that scene graph
 * onto Plastic's model, keeping everything editable:
 *
 *   pages               → one HTML file per page
 *   top-level layers    → artboards at their Figma canvas positions
 *   auto layout         → flexbox (direction, gap, padding, alignment, wrap, fill/hug/fixed)
 *   grid auto layout    → CSS grid
 *   other layers        → position: absolute with their constraints (left/right/center/scale)
 *   fills/strokes/effects, corner radius, opacity, blend, clip → CSS class rules
 *   text and style runs → <p>/<h1>… with <span>s; fonts become font- tokens
 *   variables           → tokens (other modes kept as [data-mode] blocks)
 *   image fills         → files in assets/
 *   vectors and icons   → inline <svg>, rendered by OpenPencil's SVG exporter
 */
import { parseFigFile } from '@open-pencil/core/io/formats/fig';
import { renderNodesToSVG, vectorNetworkToSVGPaths } from '@open-pencil/core/io/formats/svg';
import type { Fill, SceneGraph, SceneNode, Stroke, Variable, VectorNetwork } from '@open-pencil/scene-graph';
import { computeDescendantVisualBounds } from '@open-pencil/scene-graph/geometry';
import { slugifyClassName } from '../document/css.ts';
import { emptyDocument } from '../document/factory.ts';
import { createId } from '../document/ids.ts';
import type { Declarations, DesignDocument, DocNode, ElementNode, NodeId, Page, Point } from '../document/types.ts';
import { parseHTML } from '../serialization/html.ts';
import { serializeProject } from '../serialization/index.ts';
import { backgroundCss, blendMode, colorCss, effectDecls, fillLayer, imageExtension, px, round, withOpacity, type Layer } from './paint.ts';

export interface FontUse {
  readonly family: string;
  /** The token text uses for this family (edit it to swap the font everywhere). */
  readonly token: string;
  readonly weights: readonly number[];
  readonly italic: boolean;
  /** Text layers using it. */
  readonly layers: number;
}

export interface ImportReport {
  readonly title: string;
  readonly pages: readonly { readonly name: string; readonly file: string; readonly artboards: number }[];
  readonly layers: number;
  readonly fonts: readonly FontUse[];
  readonly images: number;
  readonly tokens: number;
  readonly warnings: readonly string[];
}

export interface Conversion {
  readonly title: string;
  /** Project files (pages, styles.css, tokens.css, project.json). */
  readonly files: Record<string, string>;
  /** Binary files by path inside the project, e.g. "assets/3f2a….png". */
  readonly assets: Record<string, Uint8Array>;
  readonly report: ImportReport;
}

/** "Marketing site (Copy).fig" → "Marketing site (Copy)". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.fig$/i, '').trim() || 'Imported from Figma';
}

export async function convertFigFile(bytes: Uint8Array, title: string): Promise<Conversion> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let graph: SceneGraph;
  try {
    graph = await parseFigFile(buffer);
  } catch (error) {
    throw new Error(`Not a readable Figma file (${error instanceof Error ? error.message : String(error)}).`);
  }
  return convertGraph(graph, title);
}

// --- conversion ------------------------------------------------------------------------------

const VECTOR_TYPES = new Set(['VECTOR', 'STAR', 'POLYGON', 'LINE', 'BOOLEAN_OPERATION']);
const SHAPE_TYPES = new Set(['RECTANGLE', 'ROUNDED_RECTANGLE', 'ELLIPSE']);
const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']);
const AUTO_LAYOUT = new Set(['HORIZONTAL', 'VERTICAL', 'GRID']);

const JUSTIFY: Record<string, string> = { CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
const ALIGN: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' };
const ALIGN_SELF: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline' };
const TEXT_ALIGN: Record<string, string> = { CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
const TEXT_CASE: Record<string, string> = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };
const DECORATION: Record<string, string> = { UNDERLINE: 'underline', STRIKETHROUGH: 'line-through' };

const isAutoLayout = (n: SceneNode | undefined): boolean => !!n && AUTO_LAYOUT.has(n.layoutMode);

class Converter {
  readonly nodes: Record<NodeId, DocNode> = {};
  readonly rules: Record<string, Record<string, string>> = {};
  readonly names: Record<NodeId, string> = {};
  readonly assets: Record<string, Uint8Array> = {};
  readonly warnings = new Set<string>();
  /** Classes by base name + declarations, so repeated identical layers (instances) share one. */
  private readonly classByKey = new Map<string, string>();
  private readonly taken = new Set<string>();
  private readonly tokenByVariable = new Map<string, string>();
  readonly tokens: Record<string, string> = {};
  private modeBlocks = new Map<string, Record<string, string>>();
  private readonly fonts = new Map<string, { token: string; weights: Set<number>; italic: boolean; layers: number }>();
  private readonly imageUrls = new Map<string, string | null>();
  private readonly graphicCache = new Map<string, boolean>();
  private svgCounter = 0;
  /** Inline SVGs; their layers start collapsed (their insides are paths, not design layers). */
  readonly svgRoots: NodeId[] = [];
  layerCount = 0;
  private readonly seen = new Set<NodeId>();

  constructor(private readonly graph: SceneGraph) {
    this.importVariables();
  }

  // --- tokens --------------------------------------------------------------------------------

  private uniqueToken(base: string): string {
    let name = base.replace(/-+$/g, '') || 'token';
    if (/^[^a-zA-Z_]/.test(name)) name = `t-${name}`;
    let n = 2;
    let candidate = name;
    while (candidate in this.tokens) candidate = `${name}-${n++}`;
    return candidate;
  }

  private tokenName(v: Variable): string {
    const slug = v.name
      .split('/')
      .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
      .filter(Boolean);
    const name = v.name.toLowerCase();
    let prefix = '';
    if (v.type === 'COLOR') {
      prefix = 'color-';
      if (/^colou?rs?$/.test(slug[0] ?? '') && slug.length > 1) slug.shift();
    } else if (v.type === 'FLOAT') {
      if (/radius|corner|round/.test(name)) prefix = 'radius-';
      else if (/font.?size|text.?size|type.?size/.test(name)) prefix = 'text-';
      else if (/line.?height|leading/.test(name)) prefix = 'leading-';
      else if (/letter|tracking/.test(name)) prefix = 'tracking-';
      else if (/weight/.test(name)) prefix = 'font-weight-';
      else if (/opacity|alpha/.test(name)) prefix = 'opacity-';
      else if (/spac|gap|padding|margin|inset|gutter/.test(name)) prefix = 'spacing-';
    } else if (v.type === 'STRING' && /font|family|typeface/.test(name)) {
      prefix = 'font-';
    }
    const body = slug.join('-');
    const stripped = prefix && body.startsWith(prefix) ? body.slice(prefix.length) : body;
    return this.uniqueToken(`${prefix}${stripped}`);
  }

  private variableValue(v: Variable, raw: unknown, name: string): string | null {
    if (raw && typeof raw === 'object' && 'aliasId' in raw) {
      const target = this.tokenByVariable.get((raw as { aliasId: string }).aliasId);
      return target ? `var(--${target})` : null;
    }
    if (v.type === 'COLOR' && raw && typeof raw === 'object') return colorCss(raw as never);
    if (v.type === 'FLOAT' && typeof raw === 'number') {
      if (/^(spacing|radius|text|leading|tracking)-/.test(name)) return px(raw);
      if (name.startsWith('opacity-')) return String(round(raw > 1 ? raw / 100 : raw, 3));
      return String(round(raw, 3));
    }
    if (v.type === 'STRING' && typeof raw === 'string') return name.startsWith('font-') ? `"${raw.replace(/"/g, '')}", ${genericFamily(raw)}` : JSON.stringify(raw);
    return null;
  }

  private importVariables(): void {
    const variables = [...this.graph.variables.values()].filter((v) => v.type !== 'BOOLEAN');
    for (const v of variables) this.tokenByVariable.set(v.id, this.tokenName(v));
    for (const v of variables) {
      const name = this.tokenByVariable.get(v.id)!;
      const collection = this.graph.variableCollections.get(v.collectionId);
      const defaultMode = collection?.defaultModeId ?? Object.keys(v.valuesByMode)[0] ?? '';
      const value = this.variableValue(v, v.valuesByMode[defaultMode], name);
      if (value === null) {
        this.tokenByVariable.delete(v.id);
        continue;
      }
      this.tokens[name] = value;
      for (const mode of collection?.modes ?? []) {
        if (mode.modeId === defaultMode || !(mode.modeId in v.valuesByMode)) continue;
        const other = this.variableValue(v, v.valuesByMode[mode.modeId], name);
        if (other === null || other === value) continue;
        const key = slugifyClassName(mode.name);
        const block = this.modeBlocks.get(key) ?? {};
        block[name] = other;
        this.modeBlocks.set(key, block);
      }
    }
  }

  /** Extra modes of variable collections (e.g. Dark), switchable with data-mode="dark". */
  modesCss(): string {
    return [...this.modeBlocks]
      .map(([mode, values]) => `[data-mode="${mode}"] {\n${Object.entries(values).map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}`)
      .join('\n\n');
  }

  /** var(--token) for a bound variable field, if any. */
  private bound(n: SceneNode, field: string): string | null {
    const id = n.boundVariables?.[field];
    const token = id ? this.tokenByVariable.get(id) : undefined;
    return token ? `var(--${token})` : null;
  }

  private length(n: SceneNode, field: string, value: number): string {
    return this.bound(n, field) ?? px(value);
  }

  private fontToken(family: string, weight: number, italic: boolean): string {
    let font = this.fonts.get(family);
    if (!font) {
      const token = this.uniqueToken(`font-${slugifyClassName(family).replace(/^el-/, '')}`);
      this.tokens[token] = `"${family.replace(/"/g, '')}", ${genericFamily(family)}`;
      font = { token, weights: new Set(), italic: false, layers: 0 };
      this.fonts.set(family, font);
    }
    font.weights.add(weight);
    font.italic ||= italic;
    return font.token;
  }

  fontUses(): FontUse[] {
    return [...this.fonts].map(([family, f]) => ({ family, token: f.token, weights: [...f.weights].sort((a, b) => a - b), italic: f.italic, layers: f.layers })).sort((a, b) => b.layers - a.layers);
  }

  // --- assets --------------------------------------------------------------------------------

  private imageUrl = (hash: string): string | null => {
    if (this.imageUrls.has(hash)) return this.imageUrls.get(hash)!;
    const bytes = this.graph.images.get(hash);
    let url: string | null = null;
    if (bytes?.length) {
      url = `assets/${hash.replace(/[^a-z0-9]/gi, '').slice(0, 40)}.${imageExtension(bytes)}`;
      this.assets[url] = bytes;
    } else {
      this.warnings.add('Some images are not embedded in the .fig file and were left out.');
    }
    this.imageUrls.set(hash, url);
    return url;
  };

  // --- elements ------------------------------------------------------------------------------

  private className(base: string, decls: Record<string, string>): string {
    const slug = slugifyClassName(base);
    const key = `${slug}\n${JSON.stringify(decls)}`;
    const existing = this.classByKey.get(key);
    if (existing) return existing;
    let name = slug;
    for (let n = 2; this.taken.has(name); n++) name = `${slug}-${n}`;
    this.taken.add(name);
    this.classByKey.set(key, name);
    this.rules[name] = decls;
    return name;
  }

  private element(tag: string, name: string, decls: Record<string, string>, children: NodeId[], attrs: Record<string, string> = {}, layerName?: string): NodeId {
    const id = createId();
    this.seen.add(id);
    const classes = Object.keys(decls).length || tag === 'div' ? [this.className(name, decls)] : [];
    this.nodes[id] = { kind: 'element', id, tag, attrs, classes, children };
    if (layerName) this.names[id] = layerName;
    this.layerCount++;
    return id;
  }

  private text(text: string): NodeId {
    const id = createId();
    this.nodes[id] = { kind: 'text', id, text };
    return id;
  }

  private visibleChildren(n: SceneNode, insideInstance: boolean): SceneNode[] {
    return n.childIds.map((id) => this.graph.getNode(id)).filter((c): c is SceneNode => !!c && (c.visible || !insideInstance));
  }

  /** Convert a top-level layer of a page into an artboard root. */
  root(n: SceneNode): NodeId | null {
    return this.convert(n, null, n.type === 'INSTANCE');
  }

  private convert(n: SceneNode, parent: SceneNode | null, insideInstance: boolean): NodeId | null {
    if (n.isMask && parent) return null; // handled by the parent (see maskedChildren)
    const inInstance = insideInstance || n.type === 'INSTANCE';
    const d: Record<string, string> = {};
    this.place(n, parent, d);

    let id: NodeId;
    if (n.type === 'TEXT' && n.textPathData) {
      id = this.textOnPath(n, d);
    } else if (n.type === 'TEXT') {
      id = this.textElement(n, d);
    } else if (this.isGraphic(n)) {
      id = this.graphic(n, d);
    } else if (SHAPE_TYPES.has(n.type) && !n.childIds.length && this.isImageShape(n)) {
      id = this.image(n, d);
    } else {
      this.boxStyle(n, d);
      if (CONTAINER_TYPES.has(n.type)) this.layout(n, d);
      const children = this.children(n, inInstance);
      const tag = n.type === 'SECTION' ? 'section' : 'div';
      id = this.element(tag, n.name, d, children, n.visible ? {} : { hidden: '' }, n.name);
      return id;
    }
    if (!n.visible) this.nodes[id] = { ...(this.nodes[id] as ElementNode), attrs: { ...(this.nodes[id] as ElementNode).attrs, hidden: '' } };
    return id;
  }

  private children(n: SceneNode, insideInstance: boolean): NodeId[] {
    const kids = this.visibleChildren(n, insideInstance);
    const out: NodeId[] = [];
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i]!;
      if (child.isMask) {
        // A mask clips the siblings above it. Rectangles and ellipses become a clipping box.
        const masked = kids.slice(i + 1);
        out.push(this.maskBox(child, n, masked, insideInstance));
        break;
      }
      const id = this.convert(child, n, insideInstance);
      if (id) out.push(id);
    }
    return out;
  }

  private maskBox(mask: SceneNode, parent: SceneNode, masked: SceneNode[], insideInstance: boolean): NodeId {
    if (!SHAPE_TYPES.has(mask.type)) this.warnings.add('Vector masks on images or text are approximated by their bounding box.');
    const d: Record<string, string> = {};
    this.place({ ...mask, layoutPositioning: 'ABSOLUTE' } as SceneNode, parent, d);
    d.overflow = 'hidden';
    this.radius(mask, d);
    d.position = 'absolute';
    // Children were positioned relative to the parent; shift them into the mask's box.
    const shifted = masked.map((c) => ({ ...c, x: c.x - mask.x, y: c.y - mask.y, layoutPositioning: 'ABSOLUTE' }) as SceneNode);
    const children = shifted.map((c) => this.convert(c, { ...mask, layoutMode: 'NONE', childIds: [] } as SceneNode, insideInstance)).filter((c): c is NodeId => !!c);
    return this.element('div', mask.name || 'mask', d, children, {}, mask.name);
  }

  // --- placement -----------------------------------------------------------------------------

  private hugsWidth(n: SceneNode): boolean {
    if (n.type === 'TEXT') return n.textAutoResize === 'WIDTH_AND_HEIGHT';
    if (!isAutoLayout(n) || n.layoutMode === 'GRID') return false;
    return (n.layoutMode === 'HORIZONTAL' ? n.primaryAxisSizing : n.counterAxisSizing) === 'HUG';
  }

  private hugsHeight(n: SceneNode): boolean {
    if (n.type === 'TEXT') return n.textAutoResize === 'WIDTH_AND_HEIGHT' || n.textAutoResize === 'HEIGHT';
    if (!isAutoLayout(n) || n.layoutMode === 'GRID') return false;
    return (n.layoutMode === 'VERTICAL' ? n.primaryAxisSizing : n.counterAxisSizing) === 'HUG';
  }

  /** Position and size of a layer within its parent. */
  private place(n: SceneNode, parent: SceneNode | null, d: Record<string, string>): void {
    let fillW = false;
    let fillH = false;
    if (!parent) {
      d.position = 'relative';
    } else if (isAutoLayout(parent) && n.layoutPositioning !== 'ABSOLUTE') {
      if (parent.layoutMode === 'GRID') {
        const g = n.gridPosition;
        if (g) {
          d['grid-column'] = `${g.column + 1} / span ${Math.max(1, g.columnSpan)}`;
          d['grid-row'] = `${g.row + 1} / span ${Math.max(1, g.rowSpan)}`;
        }
        if (n.layoutAlignSelf === 'STRETCH') fillW = fillH = true;
      } else {
        const row = parent.layoutMode === 'HORIZONTAL';
        if (n.layoutGrow > 0) {
          d.flex = `${round(n.layoutGrow)} 1 0`;
          d[row ? 'min-width' : 'min-height'] = '0';
          if (row) fillW = true;
          else fillH = true;
        } else {
          d['flex-shrink'] = '0';
        }
        const self = ALIGN_SELF[n.layoutAlignSelf];
        if (self) {
          d['align-self'] = self;
          if (n.layoutAlignSelf === 'STRETCH') {
            if (row) fillH = true;
            else fillW = true;
          }
        }
      }
    } else {
      fillW = this.absolute(n, parent, d);
    }
    if (!fillW && !this.hugsWidth(n) && !('right' in d && 'left' in d)) d.width = this.length(n, 'width', n.width);
    if (!fillH && !this.hugsHeight(n) && !('top' in d && 'bottom' in d)) d.height = this.length(n, 'height', n.height);
    if (n.minWidth) d['min-width'] = px(n.minWidth);
    if (n.maxWidth) d['max-width'] = px(n.maxWidth);
    if (n.minHeight) d['min-height'] = px(n.minHeight);
    if (n.maxHeight) d['max-height'] = px(n.maxHeight);
    if (parent && n.rotation && !this.isGraphic(n)) d.rotate = `${round(n.rotation)}deg`;
    if ((n.flipX || n.flipY) && !this.isGraphic(n)) d.scale = `${n.flipX ? -1 : 1} ${n.flipY ? -1 : 1}`;
  }

  /** Absolute position honoring constraints, relative to the parent's border box. */
  private absolute(n: SceneNode, parent: SceneNode, d: Record<string, string>): boolean {
    d.position = 'absolute';
    const inset = this.borderInset(parent);
    const x = n.x - inset.left;
    const y = n.y - inset.top;
    const pw = parent.width - inset.left - inset.right;
    const ph = parent.height - inset.top - inset.bottom;
    // Children of groups follow the group's frame; keep them pinned top-left.
    const h = parent.type === 'GROUP' ? 'MIN' : n.horizontalConstraint;
    const v = parent.type === 'GROUP' ? 'MIN' : n.verticalConstraint;
    let stretched = false;
    switch (h) {
      case 'MAX':
        d.right = px(pw - x - n.width);
        break;
      case 'STRETCH':
        d.left = px(x);
        d.right = px(pw - x - n.width);
        stretched = true;
        break;
      case 'CENTER':
        d.left = `calc(50% + ${px(x - pw / 2)})`;
        break;
      case 'SCALE':
        d.left = pw ? `${round((x / pw) * 100)}%` : px(x);
        if (pw) {
          d.width = `${round((n.width / pw) * 100)}%`;
          stretched = true;
        }
        break;
      default:
        d.left = px(x);
    }
    switch (v) {
      case 'MAX':
        d.bottom = px(ph - y - n.height);
        break;
      case 'STRETCH':
        d.top = px(y);
        d.bottom = px(ph - y - n.height);
        break;
      case 'CENTER':
        d.top = `calc(50% + ${px(y - ph / 2)})`;
        break;
      case 'SCALE':
        d.top = ph ? `${round((y / ph) * 100)}%` : px(y);
        if (ph) d.height = `${round((n.height / ph) * 100)}%`;
        break;
      default:
        d.top = px(y);
    }
    return stretched;
  }

  // --- containers ----------------------------------------------------------------------------

  private layout(n: SceneNode, d: Record<string, string>): void {
    const kids = n.childIds.map((id) => this.graph.getNode(id)).filter((c): c is SceneNode => !!c);
    const inset = this.borderInset(n);
    if (isAutoLayout(n)) {
      if (n.layoutMode === 'GRID') {
        d.display = 'grid';
        const tracks = (t: { sizing: string; value: number }[]) => t.map((x) => (x.sizing === 'FIXED' ? px(x.value) : x.sizing === 'FR' ? `${round(x.value) || 1}fr` : 'auto')).join(' ');
        if (n.gridTemplateColumns.length) d['grid-template-columns'] = tracks(n.gridTemplateColumns);
        if (n.gridTemplateRows.length) d['grid-template-rows'] = tracks(n.gridTemplateRows);
        if (n.gridRowGap || n.gridColumnGap) d.gap = n.gridRowGap === n.gridColumnGap ? px(n.gridRowGap) : `${px(n.gridRowGap)} ${px(n.gridColumnGap)}`;
      } else {
        d.display = 'flex';
        if (n.layoutMode === 'VERTICAL') d['flex-direction'] = 'column';
        if (n.layoutWrap === 'WRAP') d['flex-wrap'] = 'wrap';
        const justify = JUSTIFY[n.primaryAxisAlign];
        if (justify) d['justify-content'] = justify;
        d['align-items'] = ALIGN[n.counterAxisAlign] ?? 'flex-start';
        if (n.layoutWrap === 'WRAP' && n.counterAxisAlignContent === 'SPACE_BETWEEN') d['align-content'] = 'space-between';
        if (n.primaryAxisAlign !== 'SPACE_BETWEEN' && n.itemSpacing) {
          const gap = this.length(n, 'itemSpacing', n.itemSpacing);
          if (n.layoutWrap === 'WRAP') {
            const cross = this.length(n, 'counterAxisSpacing', n.counterAxisSpacing);
            d.gap = n.layoutMode === 'HORIZONTAL' ? `${cross} ${gap}` : `${gap} ${cross}`;
          } else {
            d.gap = gap;
          }
        } else if (n.layoutWrap === 'WRAP' && n.counterAxisSpacing) {
          d[n.layoutMode === 'HORIZONTAL' ? 'row-gap' : 'column-gap'] = this.length(n, 'counterAxisSpacing', n.counterAxisSpacing);
        }
      }
      // Figma strokes don't take layout space; the CSS border does, so padding gives it back.
      const pad = (side: 'Top' | 'Right' | 'Bottom' | 'Left', border: number) => {
        const value = n[`padding${side}`];
        if (!border) return this.length(n, `padding${side}`, value);
        return px(Math.max(0, value - border));
      };
      const p = [pad('Top', inset.top), pad('Right', inset.right), pad('Bottom', inset.bottom), pad('Left', inset.left)];
      if (p.some((v) => v !== '0')) d.padding = p[0] === p[2] && p[1] === p[3] ? (p[0] === p[1] ? p[0]! : `${p[0]} ${p[1]}`) : p.join(' ');
      if (kids.some((c) => c.layoutPositioning === 'ABSOLUTE')) d.position ??= 'relative';
    } else if (kids.length && d.position !== 'absolute') {
      d.position = 'relative';
    }
    if (n.clipsContent && n.type !== 'GROUP') d.overflow = 'hidden';
    if (d.padding || d.border || d['border-width']) d['box-sizing'] = 'border-box';
  }

  private radius(n: SceneNode, d: Record<string, string>): void {
    if (n.type === 'ELLIPSE') {
      d['border-radius'] = '50%';
      return;
    }
    if (n.independentCorners) {
      const r = [
        this.length(n, 'topLeftRadius', n.topLeftRadius),
        this.length(n, 'topRightRadius', n.topRightRadius),
        this.length(n, 'bottomRightRadius', n.bottomRightRadius),
        this.length(n, 'bottomLeftRadius', n.bottomLeftRadius),
      ];
      if (r.some((v) => v !== '0')) d['border-radius'] = r.every((v) => v === r[0]) ? r[0]! : r.join(' ');
    } else if (n.cornerRadius) {
      d['border-radius'] = this.length(n, 'cornerRadius', n.cornerRadius);
    }
  }

  private topStroke(n: SceneNode): { stroke: Stroke; index: number } | null {
    for (let i = n.strokes.length - 1; i >= 0; i--) {
      const s = n.strokes[i]!;
      if (s.visible && s.opacity > 0) return { stroke: s, index: i };
    }
    return null;
  }

  /** Border widths of an INSIDE stroke (CSS borders take space inside the box). */
  private borderInset(n: SceneNode): { top: number; right: number; bottom: number; left: number } {
    const top = this.topStroke(n);
    if (!top || top.stroke.align !== 'INSIDE' || n.type === 'TEXT' || this.isGraphic(n)) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (n.independentStrokeWeights) return { top: n.borderTopWeight, right: n.borderRightWeight, bottom: n.borderBottomWeight, left: n.borderLeftWeight };
    const w = top.stroke.weight;
    return { top: w, right: w, bottom: w, left: w };
  }

  private paintColor(n: SceneNode, field: string, fill: { color: Fill['color']; opacity: number }): string {
    const token = this.bound(n, `${field}/color`);
    return token ? withOpacity(token, fill.opacity) : colorCss(fill.color, fill.opacity);
  }

  private boxStyle(n: SceneNode, d: Record<string, string>): void {
    const layers = n.fills
      .map((f, i) => fillLayer(f, n, this.imageUrl, f.type === 'SOLID' ? (this.bound(n, `fills/${i}/color`) ?? undefined) : undefined))
      .filter((l): l is Layer => !!l);
    const background = backgroundCss(layers);
    if (background) d.background = background;

    const top = this.topStroke(n);
    if (top) {
      const { stroke } = top;
      const color = this.paintColor(n, `strokes/${top.index}`, stroke);
      const style = stroke.dashPattern?.length || n.dashPattern?.length ? 'dashed' : 'solid';
      if (stroke.align === 'INSIDE') {
        if (n.independentStrokeWeights) {
          const sides = [n.borderTopWeight, n.borderRightWeight, n.borderBottomWeight, n.borderLeftWeight];
          d['border-style'] = style;
          d['border-color'] = color;
          d['border-width'] = sides.map(px).join(' ');
        } else {
          d.border = `${px(stroke.weight)} ${style} ${color}`;
        }
        d['box-sizing'] = 'border-box';
      } else {
        // Centered and outside strokes don't change the layout in Figma; an outline doesn't either.
        d.outline = `${px(stroke.weight)} ${style} ${color}`;
        if (stroke.align === 'CENTER') d['outline-offset'] = px(-stroke.weight / 2);
      }
    }
    this.radius(n, d);
    Object.assign(d, effectDecls(n.effects, 'box'));
    this.common(n, d);
  }

  private common(n: SceneNode, d: Record<string, string>): void {
    if (n.opacity < 1) d.opacity = this.bound(n, 'opacity') ?? String(round(n.opacity, 3));
    const blend = blendMode(n.blendMode);
    if (blend) d['mix-blend-mode'] = blend;
  }

  // --- images --------------------------------------------------------------------------------

  private isImageShape(n: SceneNode): boolean {
    const visible = n.fills.filter((f) => f.visible && f.opacity > 0);
    return visible.length === 1 && visible[0]!.type === 'IMAGE' && !!visible[0]!.imageHash && !!this.imageUrl(visible[0]!.imageHash);
  }

  /** A rectangle or ellipse filled with one image becomes an <img>. */
  private image(n: SceneNode, d: Record<string, string>): NodeId {
    const fill = n.fills.find((f) => f.visible && f.type === 'IMAGE')!;
    d.display = 'block';
    d['object-fit'] = fill.imageScaleMode === 'FIT' ? 'contain' : 'cover';
    const top = this.topStroke(n);
    if (top) d.outline = `${px(top.stroke.weight)} solid ${colorCss(top.stroke.color, top.stroke.opacity)}`;
    if (top?.stroke.align === 'INSIDE') d['outline-offset'] = px(-top.stroke.weight);
    this.radius(n, d);
    Object.assign(d, effectDecls(n.effects, 'box'));
    this.common(n, d);
    return this.element('img', n.name, d, [], { src: this.imageUrl(fill.imageHash!)!, alt: n.name }, n.name);
  }

  // --- vectors -------------------------------------------------------------------------------

  /** Vector layers, and groups/frames made only of vectors and plain shapes (icons, logos). */
  private isGraphic(n: SceneNode): boolean {
    const cached = this.graphicCache.get(n.id);
    if (cached !== undefined) return cached;
    let result = false;
    const hasImage = n.fills.some((f) => f.visible && f.type === 'IMAGE');
    if (VECTOR_TYPES.has(n.type) || (n.type === 'ELLIPSE' && n.arcData && (n.arcData.innerRadius > 0 || Math.abs(n.arcData.endingAngle - n.arcData.startingAngle) < Math.PI * 2 - 1e-3))) {
      result = !hasImage;
    } else if (CONTAINER_TYPES.has(n.type) && !isAutoLayout(n) && n.childIds.length && !hasImage && n.type !== 'SECTION') {
      let vectors = 0;
      const check = (id: string): boolean => {
        const c = this.graph.getNode(id);
        if (!c || !c.visible) return true;
        if (c.type === 'TEXT' || c.fills.some((f) => f.visible && f.type === 'IMAGE')) return false;
        if (VECTOR_TYPES.has(c.type)) return ++vectors > 0;
        if (SHAPE_TYPES.has(c.type)) return true;
        if (CONTAINER_TYPES.has(c.type) && !isAutoLayout(c)) return c.childIds.every(check);
        return false;
      };
      result = n.childIds.every(check) && vectors > 0;
    }
    this.graphicCache.set(n.id, result);
    return result;
  }

  private bounds(id: string) {
    return computeDescendantVisualBounds([id], (i) => this.graph.getNode(i), (i) => this.graph.getAbsolutePosition(i));
  }

  /** One layer as SVG markup, translated so `origin` (an absolute point) is (0, 0). */
  private svgPiece(id: string, origin: Point): string {
    const svg = renderNodesToSVG(this.graph, '', [id], { xmlDeclaration: false });
    const b = this.bounds(id);
    if (!svg || !b) return '';
    // Each export numbers its defs from zero; keep ids unique within the page.
    const prefix = `g${++this.svgCounter}-`;
    const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    let inner = svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    for (const defId of ids) {
      const esc = defId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      inner = inner.replace(new RegExp(`(id="|url\\(#|href="#)${esc}(?=[")])`, 'g'), `$1${prefix}${defId}`);
    }
    const dx = round(b.minX - origin.x);
    const dy = round(b.minY - origin.y);
    return dx || dy ? `<g transform="translate(${dx} ${dy})">${inner}</g>` : inner;
  }

  /** Children in order, with masks applied to the siblings above them (SVG <mask>). */
  private svgComposite(n: SceneNode, origin: Point): string {
    const kids = n.childIds.map((id) => this.graph.getNode(id)).filter((c): c is SceneNode => !!c && c.visible);
    let out = '';
    let open = 0;
    for (const child of kids) {
      if (child.isMask) {
        const id = `m${++this.svgCounter}`;
        const type = child.maskType === 'LUMINANCE' ? 'luminance' : 'alpha';
        out += `<mask id="${id}" mask-type="${type}" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">${this.svgPiece(child.id, origin)}</mask><g mask="url(#${id})">`;
        open++;
      } else {
        out += this.hasMask(child) ? this.svgComposite(child, origin) : this.svgPiece(child.id, origin);
      }
    }
    out += '</g>'.repeat(open);
    return n.opacity < 1 ? `<g opacity="${round(n.opacity, 3)}">${out}</g>` : out;
  }

  private hasMask(n: SceneNode): boolean {
    return n.childIds.some((id) => {
      const c = this.graph.getNode(id);
      return !!c && c.visible && (c.isMask || (CONTAINER_TYPES.has(c.type) && this.hasMask(c)));
    });
  }

  /** A vector or icon: an inline <svg> sized to the layer's box (overflow shows strokes). */
  private graphic(n: SceneNode, d: Record<string, string>): NodeId {
    const origin = this.graph.getAbsolutePosition(n.id);
    const body = this.hasMask(n) ? this.svgComposite(n, origin) : this.svgPiece(n.id, origin);
    const w = round(Math.max(n.width, 0.01));
    const h = round(Math.max(n.height, 0.01));
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="none">${body}</svg>`;
    d.display = 'block';
    d.overflow = 'visible';
    Object.assign(d, effectDecls(n.effects, 'graphic'));
    const blend = blendMode(n.blendMode);
    if (blend) d['mix-blend-mode'] = blend;
    return this.adoptSvg(markup, n, d);
  }

  /** Parse SVG markup into document nodes; its root gets the layer's class. */
  private adoptSvg(markup: string, n: SceneNode, d: Record<string, string>): NodeId {
    const parsed = parseHTML(`<!doctype html><body>${markup}</body>`, this.seen);
    const rootId = parsed.roots[0];
    if (!rootId) return this.element('div', n.name, d, [], {}, n.name);
    Object.assign(this.nodes, parsed.nodes);
    this.svgRoots.push(rootId);
    const svg = parsed.nodes[rootId] as ElementNode;
    this.nodes[rootId] = { ...svg, classes: [this.className(n.name, d)] };
    this.names[rootId] = n.name;
    this.layerCount++;
    return rootId;
  }

  // --- text ----------------------------------------------------------------------------------

  /** Text on a path (curved text): an SVG <textPath>, so the words stay editable text. */
  private textOnPath(n: SceneNode, d: Record<string, string>): NodeId {
    const tp = n.textPathData!;
    const box = n.textPathBox ?? { x: 0, y: 0, width: n.width, height: n.height };
    const sx = box.width / (tp.normalizedSize.x || 1);
    const sy = box.height / (tp.normalizedSize.y || 1);
    const network = placeNetwork(tp.forward ? tp.network : reverseNetwork(tp.network), sx, sy, box.x, box.y);
    const path = vectorNetworkToSVGPaths(network).join('');
    const font = this.fontToken(n.fontFamily || 'Inter', n.fontWeight || 400, n.italic);
    this.fonts.get(n.fontFamily || 'Inter')!.layers++;
    d.display = 'block';
    d.overflow = 'visible';
    d['font-family'] = `var(--${font})`;
    d['font-size'] = px(n.fontSize || 12);
    if (n.fontWeight && n.fontWeight !== 400) d['font-weight'] = String(n.fontWeight);
    if (n.italic) d['font-style'] = 'italic';
    if (n.letterSpacing) d['letter-spacing'] = px(n.letterSpacing);
    const transform = TEXT_CASE[n.textCase];
    if (transform) d['text-transform'] = transform;
    this.common(n, d);
    const fill = n.fills.find((f) => f.visible && f.type === 'SOLID');
    const pathId = `tp${++this.svgCounter}`;
    const offset = round((tp.forward ? tp.tValue : 1 - tp.tValue) * 100);
    const text = (n.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const markup =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(n.width)} ${round(n.height)}" fill="none">` +
      `<defs><path id="${pathId}" d="${path}"></path></defs>` +
      `<text fill="${fill ? colorCss(fill.color, fill.opacity) : '#000000'}"><textPath href="#${pathId}" startOffset="${offset}%">${text}</textPath></text></svg>`;
    return this.adoptSvg(markup, n, d);
  }

  private textElement(n: SceneNode, d: Record<string, string>): NodeId {
    const font = this.fontToken(n.fontFamily || 'Inter', n.fontWeight || 400, n.italic);
    this.fonts.get(n.fontFamily || 'Inter')!.layers++;
    d.margin = '0';
    d['font-family'] = this.bound(n, 'fontFamily') ?? `var(--${font})`;
    d['font-size'] = this.length(n, 'fontSize', n.fontSize || 12);
    if (n.fontWeight && n.fontWeight !== 400) d['font-weight'] = this.bound(n, 'fontWeight') ?? String(n.fontWeight);
    if (n.italic) d['font-style'] = 'italic';
    if (n.lineHeight) d['line-height'] = this.length(n, 'lineHeight', n.lineHeight);
    if (n.letterSpacing) d['letter-spacing'] = this.length(n, 'letterSpacing', n.letterSpacing);
    const align = TEXT_ALIGN[n.textAlignHorizontal];
    if (align) d['text-align'] = align;
    const transform = TEXT_CASE[n.textCase];
    if (transform) d['text-transform'] = transform;
    const decoration = DECORATION[n.textDecoration];
    if (decoration) d['text-decoration'] = decoration;
    if (n.leadingTrim === 'CAP_HEIGHT') d['text-box'] = 'trim-both cap alphabetic';
    this.textPaint(n, n.fills, d);
    d['white-space'] = n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'pre' : 'pre-wrap';
    if (n.textTruncation === 'ENDING') {
      d.overflow = 'hidden';
      d['text-overflow'] = 'ellipsis';
      if (n.maxLines && n.maxLines > 1) {
        d.display = '-webkit-box';
        d['-webkit-box-orient'] = 'vertical';
        d['-webkit-line-clamp'] = String(n.maxLines);
      } else {
        d['white-space'] = 'nowrap';
      }
    }
    Object.assign(d, effectDecls(n.effects, 'text'));
    this.common(n, d);

    const children = this.textRuns(n);
    const plain = children.every((c) => this.nodes[c]?.kind === 'text');
    if (plain && n.textAutoResize === 'NONE' && n.textAlignVertical !== 'TOP' && !d.display) {
      d.display = 'flex';
      d['flex-direction'] = 'column';
      d['justify-content'] = n.textAlignVertical === 'CENTER' ? 'center' : 'flex-end';
    }
    return this.element(textTag(n), n.name, d, children, {}, n.name);
  }

  private textPaint(n: SceneNode, fills: readonly Fill[], d: Record<string, string>): void {
    const visible = fills.map((f, i) => ({ f, i })).filter(({ f }) => f.visible && f.opacity > 0);
    const top = visible[visible.length - 1];
    if (!top) {
      d.color = 'transparent';
    } else if (top.f.type === 'SOLID') {
      d.color = this.paintColor(n, `fills/${top.i}`, top.f);
    } else {
      const layer = fillLayer(top.f, n, this.imageUrl);
      if (layer) {
        d.background = layer.css;
        d['background-clip'] = 'text';
        d['-webkit-background-clip'] = 'text';
        d.color = 'transparent';
      }
    }
  }

  /** The text, split into spans where style runs differ from the layer's own style. */
  private textRuns(n: SceneNode): NodeId[] {
    const text = n.text ?? '';
    const runs = (n.styleRuns ?? []).filter((r) => r.length > 0 && Object.keys(r.style ?? {}).length > 0).sort((a, b) => a.start - b.start);
    if (!runs.length) return text ? [this.text(text)] : [];
    const out: NodeId[] = [];
    let at = 0;
    for (const run of runs) {
      if (run.start > at) out.push(this.text(text.slice(at, run.start)));
      const start = Math.max(run.start, at);
      const end = run.start + run.length;
      if (end <= start) continue;
      const slice = text.slice(start, end);
      const d = this.runDecls(n, run.style);
      out.push(Object.keys(d).length ? this.element('span', `${n.name}-span`, d, [this.text(slice)]) : this.text(slice));
      at = end;
    }
    if (at < text.length) out.push(this.text(text.slice(at)));
    // Merge neighbouring plain text nodes.
    return out.reduce<NodeId[]>((acc, id) => {
      const prev = acc[acc.length - 1];
      const a = prev ? this.nodes[prev] : undefined;
      const b = this.nodes[id]!;
      if (a?.kind === 'text' && b.kind === 'text') {
        this.nodes[prev!] = { ...a, text: a.text + b.text };
        delete this.nodes[id];
      } else {
        acc.push(id);
      }
      return acc;
    }, []);
  }

  private runDecls(n: SceneNode, s: NonNullable<SceneNode['styleRuns'][number]['style']>): Record<string, string> {
    const d: Record<string, string> = {};
    const family = s.fontFamily ?? n.fontFamily;
    const weight = s.fontWeight ?? n.fontWeight;
    const italic = s.italic ?? n.italic;
    if (s.fontFamily && s.fontFamily !== n.fontFamily) {
      d['font-family'] = `var(--${this.fontToken(family, weight, italic)})`;
    } else if (family) {
      this.fontToken(family, weight, italic);
    }
    if (s.fontWeight && s.fontWeight !== n.fontWeight) d['font-weight'] = String(s.fontWeight);
    if (s.italic !== undefined && s.italic !== n.italic) d['font-style'] = s.italic ? 'italic' : 'normal';
    if (s.fontSize && s.fontSize !== n.fontSize) d['font-size'] = px(s.fontSize);
    if (s.letterSpacing !== undefined && s.letterSpacing !== n.letterSpacing) d['letter-spacing'] = px(s.letterSpacing);
    if (s.lineHeight && s.lineHeight !== n.lineHeight) d['line-height'] = px(s.lineHeight);
    if (s.textDecoration && s.textDecoration !== n.textDecoration) d['text-decoration'] = DECORATION[s.textDecoration] ?? 'none';
    if (s.fills?.length) {
      const own: Record<string, string> = {};
      this.textPaint(n, s.fills, own);
      const base: Record<string, string> = {};
      this.textPaint(n, n.fills, base);
      if (own.color !== base.color || own.background !== base.background) Object.assign(d, own);
    }
    return d;
  }
}

function reverseNetwork(network: VectorNetwork): VectorNetwork {
  return {
    ...network,
    segments: network.segments.map((s) => ({ ...s, start: s.end, end: s.start, tangentStart: s.tangentEnd, tangentEnd: s.tangentStart })),
    regions: network.regions.map((r) => ({ ...r, loops: r.loops.map((loop) => [...loop].reverse()) })),
  };
}

function placeNetwork(network: VectorNetwork, sx: number, sy: number, dx: number, dy: number): VectorNetwork {
  return {
    ...network,
    vertices: network.vertices.map((v) => ({ ...v, x: v.x * sx + dx, y: v.y * sy + dy })),
    segments: network.segments.map((s) => ({
      ...s,
      tangentStart: { x: s.tangentStart.x * sx, y: s.tangentStart.y * sy },
      tangentEnd: { x: s.tangentEnd.x * sx, y: s.tangentEnd.y * sy },
    })),
  };
}

/** Big, short text reads as a heading; everything else is a paragraph. */
function textTag(n: SceneNode): string {
  const short = (n.text ?? '').length <= 120 && !(n.text ?? '').includes('\n');
  if (!short) return 'p';
  if (n.fontSize >= 40) return 'h1';
  if (n.fontSize >= 28) return 'h2';
  if (n.fontSize >= 20 && n.fontWeight >= 600) return 'h3';
  return 'p';
}

function genericFamily(family: string): string {
  const f = family.toLowerCase();
  if (/mono|code|consol|courier/.test(f)) return 'monospace';
  if (/serif/.test(f) && !/sans/.test(f)) return 'serif';
  if (/georgia|times|garamond|playfair|merriweather|lora|baskerville|caslon|didot|bodoni/.test(f)) return 'serif';
  return 'sans-serif';
}

function pageFileName(name: string, index: number, taken: Set<string>): string {
  if (index === 0) {
    taken.add('index.html');
    return 'index.html';
  }
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `page-${index + 1}`;
  let file = `${base}.html`;
  for (let n = 2; taken.has(file) || file === 'index.html'; n++) file = `${base}-${n}.html`;
  taken.add(file);
  return file;
}

/** Needs a global DOMParser (browsers have one; the server installs jsdom's). */
export function convertGraph(graph: SceneGraph, title: string): Conversion {
  const c = new Converter(graph);
  const pages: Page[] = [];
  const frames: Record<NodeId, Point> = {};
  const fileNames = new Set<string>();
  const report: { name: string; file: string; artboards: number }[] = [];

  graph.getPages().forEach((canvas, index) => {
    const file = pageFileName(canvas.name, index, fileNames);
    const roots: NodeId[] = [];
    for (const childId of canvas.childIds) {
      const n = graph.getNode(childId);
      if (!n) continue;
      const id = c.root(n);
      if (!id) continue;
      roots.push(id);
      frames[id] = { x: round(n.x), y: round(n.y) };
    }
    pages.push({ file, name: canvas.name || `Page ${index + 1}`, roots });
    report.push({ name: canvas.name, file, artboards: roots.length });
  });
  if (!pages.length) throw new Error('The Figma file has no pages.');

  const base = emptyDocument(title);
  const modes = c.modesCss();
  const doc: DesignDocument = {
    ...base,
    title,
    nodes: c.nodes,
    pages,
    styles: { ...base.styles, rules: c.rules as Record<string, Declarations> },
    tokens: { values: c.tokens, preserved: modes },
    frames,
    names: c.names,
  };
  const files = serializeProject(doc, { viewport: null, collapsed: [...pages.flatMap((p) => p.roots), ...c.svgRoots], activePage: pages[0]!.file });
  return {
    title,
    files,
    assets: c.assets,
    report: {
      title,
      pages: report,
      layers: c.layerCount,
      fonts: c.fontUses(),
      images: Object.keys(c.assets).length,
      tokens: Object.keys(c.tokens).length,
      warnings: [...c.warnings],
    },
  };
}
