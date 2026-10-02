/** Import a .fig file into the workspace as a new Plastic project. */
import type { ProjectStore } from '../projectStore.ts';
import { convertFigFile, type ImportReport } from './convert.ts';

export interface ImportResult {
  readonly id: string;
  readonly report: ImportReport;
}

/** "Marketing site (Copy).fig" → "Marketing site (Copy)". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.fig$/i, '').trim() || 'Imported from Figma';
}

export async function importFigma(store: ProjectStore, bytes: Uint8Array, fileName: string): Promise<ImportResult> {
  const conversion = await convertFigFile(bytes, titleFromFileName(fileName));
  const id = await store.uniqueId(conversion.title);
  // Assets first, so the editor never opens pages whose images are still being written.
  await store.writeAssets(id, conversion.assets);
  await store.write(id, conversion.files);
  return { id, report: conversion.report };
}
