import { Image, ImagePlus, RectangleHorizontal, SquareSplitHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import valueParser from 'postcss-value-parser';
import type { NodeId } from '../../document/types.ts';
import { setStyleOnNodes } from '../../document/ops.ts';
import { useEditor } from '../../editor/store.ts';
import { colorWithAlpha, cssGradient, gradientFrom, parseCssGradient } from '../../paint/gradient.ts';
import { GradientEditor } from './GradientEditor.tsx';
import { Eyedropper, paintColor, PaintColorRow } from './PaintColor.tsx';
import { clearStyles, computedValue, CssInput, CssSelect, MIXED, Row, Section, TextInput, TokenSlot, useAnyDeclared, useDeclared } from './fields.tsx';

type Ids = { ids: readonly NodeId[] };
const BACKGROUND_PROPS = ['background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat'];
const CLIP_PROPS = ['background-clip', '-webkit-background-clip'];

export function FillSection({ ids, textual = false }: Ids & { textual?: boolean }) {
  const background = useAnyDeclared(ids, BACKGROUND_PROPS);
  const clip = useDeclared(ids, 'background-clip');
  const webkitClip = useDeclared(ids, '-webkit-background-clip');
  const clipped = clip === 'text' || webkitClip === 'text';
  return <>
    <FillControls key={`${ids.join(',')}:${textual}`} ids={ids} textual={textual} />
    {textual && background && !clipped && <FillControls key={`background:${ids.join(',')}`} ids={ids} title="Background" />}
  </>;
}

function FillControls({ ids, textual = false, title = 'Fill' }: Ids & { textual?: boolean; title?: string }) {
  const declared = useDeclared(ids, 'background');
  const image = useDeclared(ids, 'background-image');
  const clip = useDeclared(ids, 'background-clip');
  const webkitClip = useDeclared(ids, '-webkit-background-clip');
  const textColor = useDeclared(ids, 'color');
  const present = useAnyDeclared(ids, BACKGROUND_PROPS);
  const backgroundColor = useDeclared(ids, 'background-color');
  const textPaint = textual && (clip === 'text' || webkitClip === 'text');
  const raw = textual && !textPaint ? textColor : (image && image !== 'none' ? image : declared || backgroundColor);
  const mixed = raw === MIXED;
  const gradient = !mixed ? parseCssGradient(raw) : null;
  const imageFill = /url\(/i.test(raw);
  const [draftMode, setDraftMode] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const mode = gradient || /gradient\(/i.test(raw) ? 'gradient' : imageFill ? 'image' : draftMode ?? 'solid';
  const computed = computedValue(ids[0], textual && !textPaint ? 'color' : 'background-color');
  const base = gradient?.stops[0] ?? paintColor(raw) ?? paintColor(computed) ?? { color: '#ffffff', alpha: 1 };

  const write = (value: string, reset = false) => {
    useEditor.getState().apply(`Set ${title}`, (doc) => {
      let next = doc;
      if (textual && !textPaint && !/(?:gradient|url)\(/i.test(value)) return setStyleOnNodes(next, ids, 'color', value || null);
      for (const prop of reset ? BACKGROUND_PROPS : ['background-color', 'background-image']) next = setStyleOnNodes(next, ids, prop, null);
      next = setStyleOnNodes(next, ids, 'background', value || null);
      if (reset && /url\(/i.test(value)) {
        next = setStyleOnNodes(next, ids, 'background-size', 'cover');
        next = setStyleOnNodes(next, ids, 'background-position', 'center');
        next = setStyleOnNodes(next, ids, 'background-repeat', 'no-repeat');
      }
      if (textual) {
        const isPaint = /(?:gradient|url)\(/i.test(value);
        for (const prop of CLIP_PROPS) next = setStyleOnNodes(next, ids, prop, isPaint ? 'text' : null);
        next = setStyleOnNodes(next, ids, 'color', isPaint ? 'transparent' : value || null);
        if (!isPaint) next = setStyleOnNodes(next, ids, 'background', null);
      }
      return next;
    }, { coalesce: reset ? undefined : `fill:${ids.join(',')}` });
  };

  const changeMode = (next: string) => {
    setDraftMode(next);
    if (next === 'solid') write(colorWithAlpha(base.color, base.alpha), true);
    else if (next === 'gradient') write(cssGradient(gradient ?? gradientFrom(base.color, base.alpha, 'linear')), true);
    // Wait for an image before replacing the existing fill.
  };
  // A pending Image choice is UI state; changing it must not discard the previous fill.
  const shownMode = draftMode === 'image' && !imageFill ? 'image' : mode;
  return <Section title={title} empty={!textual && !present && !expanded}
    onAdd={() => { setExpanded(true); write('#ffffff', true); }}
    onRemove={() => { setExpanded(false); setDraftMode(null); clearStyles(ids, textual ? (textPaint ? [...BACKGROUND_PROPS, ...CLIP_PROPS, 'color'] : ['color']) : BACKGROUND_PROPS, `Remove ${title}`); }}>
    <div className="paint-type-row">
      <div className="paint-types" role="radiogroup" aria-label="Fill Type">
        {[{ value: 'solid', label: 'Solid', Icon: RectangleHorizontal }, { value: 'gradient', label: 'Gradient', Icon: SquareSplitHorizontal }, { value: 'image', label: 'Image', Icon: Image }].map(({ value, label, Icon }) =>
          <button type="button" key={value} role="radio" aria-label={label} aria-checked={!mixed && shownMode === value} title={`${label} Fill`} onClick={() => changeMode(value)}><Icon size={15} strokeWidth={1.5} /></button>)}
      </div>
      {mixed && <span className="insp-hint">Mixed</span>}
    </div>
    {shownMode === 'image' ? <ImageFill ids={ids} raw={raw} onChange={(value) => write(value, true)} /> : gradient ?
      <GradientEditor gradient={gradient} onChange={(g) => write(cssGradient(g))} /> : shownMode === 'gradient' ?
      <Row><CssInput ids={ids} prop="background" mono /></Row> :
      <TokenSlot ids={ids} prop={textual ? 'color' : 'background'}><PaintColorRow value={mixed ? '' : raw} fallback={computed} onChange={(value) => write(value)} aside={<Eyedropper onChange={(value) => write(colorWithAlpha(value, base.alpha))} />} /></TokenSlot>}
  </Section>;
}

function ImageFill({ ids, raw, onChange }: Ids & { raw: string; onChange(value: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const assetBase = useEditor(state => state.assetBase);
  const url = valueParser(raw).nodes.find(node => node.type === 'function' && node.value.toLowerCase() === 'url');
  const source = url?.type === 'function' ? valueParser.stringify(url.nodes).replace(/^["']|["']$/g, '') : '';
  let preview: string | undefined;
  try { if (source) preview = `url(${JSON.stringify(new URL(source, assetBase ?? location.href).href)})`; }
  catch { /* An incomplete URL stays editable. */ }
  return <div className="paint-image">
    <button type="button" className="paint-image-preview checkerboard" aria-label="Choose Fill Image" onClick={() => input.current?.click()}>
      {/url\(/i.test(raw) ? <span style={{ backgroundImage: preview, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} /> : <ImagePlus size={28} strokeWidth={1} />}
      <span className="paint-image-caption">{loading ? 'Loading Image…' : /url\(/i.test(raw) ? 'Replace Image' : 'Choose Image'}</span>
    </button>
    <input ref={input} type="file" accept="image/*" hidden onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { setError('Choose an image smaller than 10 MB.'); return; }
      setLoading(true); setError(null);
      const nodes = ids.map(id => useEditor.getState().doc.nodes[id]);
      const reader = new FileReader();
      reader.onerror = () => { setLoading(false); setError('Couldn’t read this image. Try another file.'); };
      reader.onload = () => {
        setLoading(false);
        // A file chooser may outlive navigation. Never write into a different document.
        if (!ids.every((id, i) => useEditor.getState().doc.nodes[id] === nodes[i])) return;
        onChange(`url("${String(reader.result)}") center / cover no-repeat`);
      };
      reader.readAsDataURL(file);
    }} />
    <Row><CssSelect ids={ids} prop="background-size" label="Size" options={[{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }, { value: '100% 100%', label: 'Stretch' }, { value: 'auto', label: 'Original' }]} /></Row>
    <Row><CssSelect ids={ids} prop="background-position" label="Position" options={['center', 'top', 'bottom', 'left', 'right'].map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} /><CssSelect ids={ids} prop="background-repeat" label="Repeat" options={[{ value: 'no-repeat', label: 'No Repeat' }, { value: 'repeat', label: 'Tile' }]} /></Row>
    <Row><TextInput ariaLabel="Fill Image URL" prefix="URL" value={source.startsWith('data:') ? '' : source} placeholder={source.startsWith('data:') ? 'Embedded Image' : 'https://…'} onChange={(value) => onChange(value.trim() ? `url(${JSON.stringify(value.trim())}) center / cover no-repeat` : '')} /></Row>
    {error && <p className="insp-hint" role="alert">{error}</p>}
  </div>;
}
