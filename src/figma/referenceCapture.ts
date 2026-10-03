/** Metadata exported by the read-only Figma reference plugin; hashes prove integrity, not authorship. */
import { z } from 'zod';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const referenceCaptureSchema = z.object({
  schemaVersion: z.literal(1),
  exporterVersion: z.string(),
  fileName: z.string(),
  pageName: z.string(),
  capturedAt: z.string().datetime(),
  hashes: z.record(z.string(), hex),
  frames: z.array(z.object({
    id: z.string(), sourceId: z.string(), name: z.string(),
    sourceWidth: z.number().finite().positive(), sourceHeight: z.number().finite().positive(),
    width: z.number().int().positive(), height: z.number().int().positive(),
    fonts: z.array(z.object({ family: z.string(), style: z.string(), weights: z.array(z.number().int().positive()) })),
  })).min(1),
});
