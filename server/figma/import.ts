/** Import a .fig file into the workspace as a new Plastic project. */
import type { ProjectStore } from '../projectStore.ts';
import { convertFigFile, titleFromFileName, type ImportReport } from '../../src/figma/convert.ts';
import { ensureDom } from '../mcp/dom.ts';

export interface ImportResult {
  readonly id: string;
  readonly report: ImportReport;
}

export async function importFigma(store: ProjectStore, bytes: Uint8Array, fileName: string): Promise<ImportResult> {
  ensureDom();
  const conversion = await convertFigFile(bytes, titleFromFileName(fileName));
  const id = await store.uniqueId(conversion.title);
  // Assets first, so the editor never opens pages whose images are still being written.
  await store.writeAssets(id, conversion.assets);
  await store.write(id, conversion.files);
  return { id, report: conversion.report };
}
