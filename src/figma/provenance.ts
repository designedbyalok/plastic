/** Import observations, kept in project.json rather than shipped markup. No training upload. */
import { z } from 'zod';

export const FIGMA_IMPORTER_VERSION = '1.1.0';
const bounds = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() });
export const importTraceSchema = z.object({
  schemaVersion: z.literal(1),
  importerVersion: z.string().max(64),
  source: z.literal('figma'),
  nodes: z.array(z.object({
    sourceId: z.string().min(1).max(128),
    sceneId: z.string().max(128).optional(),
    plasticId: z.string().regex(/^[\w-]{1,64}$/),
    page: z.string().max(128),
    name: z.string(),
    type: z.string().max(64),
    bounds,
    disposition: z.enum(['converted', 'flattened']),
  })),
  diagnostics: z.array(z.object({
    code: z.enum(['missing-image', 'mask-approximation', 'instance-expanded', 'unsupported-node', 'vector-flattened']),
    severity: z.enum(['info', 'warning']),
    sourceId: z.string().max(128),
    sourceName: z.string(),
    property: z.string().max(128),
    message: z.string(),
  })),
});
export type ImportTrace = z.infer<typeof importTraceSchema>;
export type ImportDiagnostic = ImportTrace['diagnostics'][number];
export function readImportTrace(raw: unknown): ImportTrace | undefined {
  if (raw === undefined) return undefined;
  const result = importTraceSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
