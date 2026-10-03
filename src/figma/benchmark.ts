/** Versioned, local benchmark manifests. References are never replaced by importer output. */
import { z } from 'zod';
const path = z.string().min(1).refine((s) => !s.startsWith('/') && !s.includes('\\') && !s.split('/').includes('..'), 'Use a relative path inside the fixture directory.');
export const benchmarkSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  source: z.object({ kind: z.enum(['figma', 'synthetic']), path }),
  capture: path.optional(),
  fonts: z.array(z.object({ family: z.string().min(1), path, style: z.enum(['normal', 'italic']).default('normal'), weight: z.string().regex(/^[1-9][0-9]{0,2}( [1-9][0-9]{0,2})?$/).default('400') })).default([]),
  frames: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    sourceId: z.string().min(1),
    width: z.number().int().positive().max(8192),
    height: z.number().int().positive().max(8192),
    reference: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('figma-png'), path }),
      z.object({ kind: z.literal('synthetic-html'), path }),
    ]),
    maxDiffRatio: z.number().min(0).max(1).default(0.01),
    nodes: z.array(z.object({
      sourceId: z.string(),
      bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative() }),
      text: z.string().optional(),
      fontWeight: z.string().optional(),
      display: z.string().optional(),
    })).default([]),
  })).min(1),
}).superRefine((manifest, ctx) => {
  if (new Set(manifest.frames.map((f) => f.id)).size !== manifest.frames.length)
    ctx.addIssue({ code: 'custom', message: 'Frame IDs must be unique.' });
  if (manifest.source.kind === 'synthetic' && manifest.frames.some((f) => f.reference.kind === 'figma-png'))
    ctx.addIssue({ code: 'custom', message: 'Synthetic sources cannot claim Figma reference fidelity.' });
});
