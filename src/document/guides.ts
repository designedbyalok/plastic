/** Alignment aids live in project metadata, never in exported HTML or CSS. */
import type { DesignDocument, RulerGuide } from './types.ts';
export function setRulerGuide(doc: DesignDocument, page: string, guide: RulerGuide): DesignDocument {
  if (!Number.isFinite(guide.value)) return doc;
  return { ...doc, pages: doc.pages.map((p) => {
    if (p.file !== page) return p;
    const guides = p.guides ?? [];
    return { ...p, guides: guides.some((g) => g.id === guide.id) ? guides.map((g) => g.id === guide.id ? guide : g) : [...guides, guide] };
  }) };
}
export function removeRulerGuide(doc: DesignDocument, page: string, id: string): DesignDocument {
  return { ...doc, pages: doc.pages.map((p) => p.file === page ? { ...p, guides: (p.guides ?? []).filter((g) => g.id !== id) } : p) };
}
