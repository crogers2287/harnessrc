import { z } from 'zod';
export const permissionSettingsSchema = z.object({
  supported: z.boolean(),
  current: z.string().optional(),
  reason: z.string().optional(),
  options: z.array(
    z.object({
      value: z.string().min(1).max(100),
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
});
export type PermissionSettings = z.infer<typeof permissionSettingsSchema>;
