/**
 * The manifest of schema version 1, as extension authors wrote it before
 * pages existed. It stays valid: `normalize.ts` turns it into the one
 * internal model. Pure, so it is unit-tested.
 */
import { z } from 'zod';

import { headersSchema, headFields, PERMISSIONS_V1, v1Contributions } from './common';

export const manifestSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  ...headFields,
  permissions: z.array(z.enum(PERMISSIONS_V1)).max(PERMISSIONS_V1.length).default(['network']),
  headers: headersSchema,
  contributes: z.object(v1Contributions).default({}),
});
export type ManifestV1 = z.infer<typeof manifestSchemaV1>;
