import { z } from 'zod';

/** Trusted installation configuration: clients select IDs, never native flags. */
export const launchPermissionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  description: z.string().default(''),
  args: z.array(z.string()).default([]),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  approvalPolicy: z.enum(['on-request', 'never']).optional(),
});
