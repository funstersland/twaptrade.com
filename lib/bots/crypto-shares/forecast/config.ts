import { z } from "zod";
export const configSchema = z
  .object({
    horizons: z
      .array(z.union([z.literal(300), z.literal(900), z.literal(3600)]))
      .max(3)
      .refine((v) => new Set(v).size === v.length, "Duplicate timeframe"),
    baseLotCents: z.number().int().min(100).max(1000000),
    bankrollCents: z.number().int().min(1000).max(100000000),
    maxStakeBp: z.number().int().min(10).max(1000),
    dailyLossBp: z.number().int().min(50).max(2000),
    maxEntryCents: z.number().int().min(10).max(65),
    maxSpreadCents: z.number().int().min(1).max(5),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;
export const DEFAULT_CONFIG: Config = {
  horizons: [300, 900, 3600],
  baseLotCents: 1000,
  bankrollCents: 100000,
  maxStakeBp: 200,
  dailyLossBp: 500,
  maxEntryCents: 52,
  maxSpreadCents: 2,
};
