/** Page edits. A page is one HTML file; its file name never changes after creation (stable diffs). */
import { FIRST_PAGE_FILE } from './factory';
import { removeNodes } from './ops';
import type { DesignDocument } from './types';

function pageFileFor(doc: DesignDocument, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'page';
  const taken = new Set(doc.pages.map((p) => p.file));
  let file = `${base}.html`;
  for (let n = 2; taken.has(file) || file === FIRST_PAGE_FILE; n++) file = `${base}-${n}.html`;
  return file;
}

export function nextPageName(doc: DesignDocument): string {
  const names = new Set(doc.pages.map((p) => p.name));
  let n = doc.pages.length + 1;
  while (names.has(`Page ${n}`)) n++;
  return `Page ${n}`;
}

/** Add an empty page after `afterFile` (or at the end). */
export function addPage(doc: DesignDocument, name: string, afterFile?: string): { doc: DesignDocument; file: string } {
  const file = pageFileFor(doc, name);
  const index = afterFile ? doc.pages.findIndex((p) => p.file === afterFile) + 1 : doc.pages.length;
  const pages = [...doc.pages];
  pages.splice(index <= 0 ? pages.length : index, 0, { file, name, roots: [] });
  return { doc: { ...doc, pages }, file };
}

export function renamePage(doc: DesignDocument, file: string, name: string): DesignDocument {
  const trimmed = name.trim();
  if (!trimmed) return doc;
  return { ...doc, pages: doc.pages.map((p) => (p.file === file && p.name !== trimmed ? { ...p, name: trimmed } : p)) };
}

/** Delete a page and everything on it. The last page cannot be deleted. */
export function removePage(doc: DesignDocument, file: string): DesignDocument {
  const page = doc.pages.find((p) => p.file === file);
  if (!page || doc.pages.length <= 1) return doc;
  const cleared = removeNodes(doc, page.roots);
  return { ...cleared, pages: cleared.pages.filter((p) => p.file !== file) };
}

/** Canvas background for a page; null restores the default. */
export function setPageCanvas(doc: DesignDocument, file: string, color: string | null): DesignDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => {
      if (p.file !== file || (p.canvas ?? null) === color) return p;
      const { canvas: _old, ...rest } = p;
      return color ? { ...rest, canvas: color } : rest;
    }),
  };
}

export function movePage(doc: DesignDocument, file: string, toIndex: number): DesignDocument {
  const from = doc.pages.findIndex((p) => p.file === file);
  if (from < 0) return doc;
  const pages = [...doc.pages];
  const [page] = pages.splice(from, 1);
  pages.splice(Math.max(0, Math.min(pages.length, toIndex)), 0, page!);
  return { ...doc, pages };
}
