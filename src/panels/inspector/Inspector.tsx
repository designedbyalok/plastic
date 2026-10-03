import { EditorPresence } from '../../app/EditorPresence.tsx';
import { Menu, MenuContent } from '../ui/Menu.tsx';
import { ComponentSection, ComponentLibrarySection } from './ComponentSection.tsx';
import { SourceSection } from './SourceSection.tsx';
import { ScrollArea } from '../ui/ScrollArea.tsx';
import { VariantsSection } from './VariantsSection.tsx';
import { pageOf } from '../../document/tree.ts';
import { useAsThumbnail } from '../../editor/thumbnail.ts';
import { copyFrameContext, copyFrameLink } from '../../editor/frameLinks.ts';
import { resolvedTheme, useTheme } from '../../app/theme.ts';
import { ChevronDown, Pipette } from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from '../../editor/commands.ts';
import { activeRoots, useEditor } from '../../editor/store.ts';
import { getElement } from '../../document/tree.ts';
import { setPageCanvas } from '../../document/pages.ts';
import type { ElementNode } from '../../document/types.ts';
import { elementSpec } from '../../elements/registry.ts';
import { VectorSections } from './VectorSections.tsx';
import { PathOpsSection } from './PathOpsSection.tsx';
import {
  AttributesSection,
  BehaviorSection,
  ContentSection,
  ElementSection,
  TableSection,
} from './ElementSections.tsx';
import {
  BorderSection,
  ConstraintsSection,
  CssSection,
  FillSection,
  LayoutSection,
  MarginSection,
  OpacitySection,
  RadiusSection,
  ShadowSection,
  TextSection,
} from './StyleSections.tsx';

export function Inspector() {
  const [settingThumbnail, setSettingThumbnail] = useState(false);
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  // Computed-value placeholders read the live DOM; re-read once after new artboards mount.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const rootCount = useEditor((s) => activeRoots(s).length);
  useEffect(() => {
    const raf = requestAnimationFrame(refresh);
    return () => cancelAnimationFrame(raf);
  }, [rootCount, selection]);

  const elements = selection.map((id) => getElement(doc, id)).filter((el): el is ElementNode => !!el);
  const single = elements.length === 1 ? elements[0]! : null;
  const ids = elements.map((el) => el.id);
  // Vectors (svg) get Fill/Stroke for their shapes instead of the box's fill, border and text.
  const vector = elements.length > 0 && elements.every((el) => el.tag === 'svg');
  const textual = elements.every((el) => {
    const spec = elementSpec(el.tag);
    return spec.editableText || spec.category === 'text' || spec.category === 'form';
  });

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <ScrollArea className="inspector-scroll" viewportClassName="inspector-content">
      <InspectorHeader />
      {!elements.length ? (
        <EmptyInspector />
      ) : (
        <div key={ids.join(',')}>
          {single ? (
            <ElementSection el={single} />
          ) : (
            <section className="insp-section">
              <div className="insp-header">
                <span className="insp-title">{elements.length} Elements</span>
              </div>
            </section>
          )}
          {single && pageOf(doc, single.id) && <div className="frame-share-actions">
            <button type="button" className="insp-chip" onClick={() => void copyFrameLink(single.id)}>Copy Frame Link</button>
            <button type="button" className="insp-chip" onClick={() => void copyFrameContext(single.id)}>Copy AI Context</button>
            <button type="button" className="insp-chip" disabled={settingThumbnail} aria-pressed={doc.thumbnail?.frame === single.id} onClick={() => { setSettingThumbnail(true); void useAsThumbnail(single.id).finally(() => setSettingThumbnail(false)); }}>{settingThumbnail ? 'Rendering Thumbnail…' : doc.thumbnail?.frame === single.id ? 'Update Thumbnail' : 'Use as Thumbnail'}</button>
            {doc.thumbnail?.frame === single.id && <button type="button" className="insp-chip" onClick={() => useEditor.getState().apply('Remove file thumbnail', (d) => { const { thumbnail, ...rest } = d; return rest; })}>Remove Thumbnail</button>}
          </div>}
          {single && <ComponentSection el={single} />}
          {single && <ContentSection el={single} />}
          {single && <BehaviorSection el={single} />}
          {single && <TableSection el={single} />}
          <LayoutSection ids={ids} />
          <PathOpsSection ids={ids} />
          {!vector && <RadiusSection ids={ids} />}
          <OpacitySection ids={ids} />
          {vector ? (
            <VectorSections ids={ids} />
          ) : (
            <>
              <FillSection ids={ids} textual={textual} />
              <TextSection ids={ids} textual={textual} />
              <BorderSection ids={ids} />
            </>
          )}
          <ShadowSection ids={ids} />
          <MarginSection ids={ids} />
          <ConstraintsSection ids={ids} />
          {single && <CssSection el={single} />}
          {single && <VariantsSection key={single.id} el={single} />}
          {single && <SourceSection el={single} />}
          {single && <AttributesSection el={single} />}
        </div>
      )}
      </ScrollArea>
    </aside>
  );
}

function InspectorHeader() {
  const codeOpen = useEditor((s) => s.codeOpen);
  return (
    <header className="insp-top">
      <EditorPresence />
      <span className="insp-top-actions">
        <ZoomMenu />
        <button
          type="button"
          className={`insp-top-button${codeOpen ? ' is-active' : ''}`}
          aria-pressed={codeOpen}
          onClick={() => useEditor.getState().setCodeOpen(!codeOpen)}
          title="Show the HTML and CSS being saved"
        >
          Code
        </button>
      </span>
    </header>
  );
}

const ZOOM_ITEMS = [
  { label: 'Zoom In', kbd: '⌘ +', run: () => zoomBy(1.25) },
  { label: 'Zoom Out', kbd: '⌘ −', run: () => zoomBy(0.8) },
  { label: 'Zoom to 100%', kbd: '⇧ 0', run: () => zoomTo(1) },
  { label: 'Zoom to Fit', kbd: '⇧ 1', run: zoomToFit },
  { label: 'Zoom to Selection', kbd: '⇧ 2', run: zoomToSelection },
];

function ZoomMenu() {
  const zoom = useEditor((s) => s.viewport.zoom);
  const [open, setOpen] = useState(false);
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}><span className="insp-menu-anchor">
      <Menu.Trigger asChild><button
        type="button"
        className="insp-zoom"
        aria-haspopup="menu"
        aria-expanded={open}

      >
        {Math.round(zoom * 100)}%
        <ChevronDown size={12} strokeWidth={1.5} />
      </button></Menu.Trigger>
      {open && (
        <MenuContent align="end" aria-label="Zoom">
          {ZOOM_ITEMS.map((item) => (
            <Menu.Item
              key={item.label}
              className="insp-menu-item"
              onSelect={() => {
                item.run();
                setOpen(false);
              }}
            >
              <span>{item.label}</span>
              <kbd>{item.kbd}</kbd>
            </Menu.Item>
          ))}
        </MenuContent>
      )}
    </span></Menu.Root>
  );
}

/** The theme's canvas color (pages without their own color show it). */
const CANVAS_DEFAULTS = { dark: '#282828', light: '#f2f2f2' } as const;

/** "#28282880" → { hex: "282828", alpha: 50 }. */
function splitColor(color: string, fallback: string): { hex: string; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!m) return { hex: fallback.slice(1), alpha: 100 };
  return { hex: m[1]!.toLowerCase(), alpha: m[2] ? Math.round((parseInt(m[2], 16) / 255) * 100) : 100 };
}

function joinColor(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(100, Math.round(alpha)));
  return a >= 100
    ? `#${hex}`
    : `#${hex}${Math.round((a / 100) * 255)
        .toString(16)
        .padStart(2, '0')}`;
}

/** Nothing selected: settings for the page itself, and connecting agents. */
function EmptyInspector() {
  const page = useEditor((s) => s.doc.pages.find((p) => p.file === s.activePage) ?? s.doc.pages[0]!);
  const theme = useTheme();
  const fallback = CANVAS_DEFAULTS[theme === 'system' ? resolvedTheme() : theme];
  const { hex, alpha } = splitColor(page.canvas ?? fallback, fallback);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const set = (color: string) => {
    // Picking the theme's own canvas color means "no page color": it keeps following the theme.
    const value = color.toLowerCase() === fallback ? null : color;
    useEditor
      .getState()
      .apply('Canvas color', (d) => setPageCanvas(d, page.file, value), { coalesce: `canvas:${page.file}` });
  };
  const eyeDropper = (window as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;

  return (
    <>
      <section className="insp-section">
        <div className="insp-header">
          <span className="insp-title">Page</span>
        </div>
        <div className="insp-body">
          <div className="insp-row">
            <span className="insp-field insp-color-row">
              <input
                className="insp-input has-prefix has-suffix is-mono"
                aria-label="Canvas color"
                value={hexDraft ?? hex.toUpperCase()}
                spellCheck={false}
                onChange={(e) => {
                  const v = e.target.value.replace(/^#/, '');
                  setHexDraft(v);
                  if (/^[0-9a-f]{6}$/i.test(v)) set(joinColor(v.toLowerCase(), alpha));
                }}
                onBlur={() => setHexDraft(null)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
              />
              <span className="insp-prefix">
                <input
                  type="color"
                  className="insp-swatch"
                  aria-label="Pick canvas color"
                  value={`#${hex}`}
                  onChange={(e) => set(joinColor(e.target.value.slice(1), alpha))}
                />
              </span>
              <input
                className="insp-alpha"
                aria-label="Canvas opacity"
                value={`${alpha}%`}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isFinite(n)) set(joinColor(hex, n));
                }}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
              />
            </span>
            {eyeDropper && (
              <button
                type="button"
                className="icon-button"
                title="Pick a color from the screen"
                aria-label="Pick a color from the screen"
                onClick={() => {
                  void new eyeDropper()
                    .open()
                    .then((r) => set(joinColor(r.sRGBHex.replace(/^#/, '').slice(0, 6), alpha)))
                    .catch(() => {});
                }}
              >
                <Pipette size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      </section>
      <ComponentLibrarySection />
      <section className="insp-section">
        <div className="insp-header">
          <span className="insp-title">MCP</span>
        </div>
        <div className="insp-body">
          <div className="insp-row">
            <button type="button" className="insp-button" onClick={() => useEditor.getState().setAgentsOpen(true)}>
              Connect More Agents
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
