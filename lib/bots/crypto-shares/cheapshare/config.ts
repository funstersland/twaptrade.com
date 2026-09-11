import { z } from "zod";
import { PAIRS } from "./identity.ts";
const bp = z.number().int().min(1).max(100);
export const presetSchema = z
  .object({
    enabled: z.boolean(),
    crowdBp: bp,
    crowdSeconds: z.number().int().min(10).max(120),
    leadBp: bp,
    holdSeconds: z.number().int().min(3).max(30),
    holdBufferBp: bp,
    clearBufferBp: bp,
    flattenSeconds: z.number().int().min(5).max(60),
  })
  .strict();
export const configSchema = z
  .object({
    bankrollCents: z.number().int().min(10000).max(100000000),
    riskBp: z.number().int().min(1).max(200),
    setupB: z.boolean(),
    setupBRiskBp: z.number().int().min(1).max(100),
    dailyLossBp: z.number().int().min(100).max(1000),
    weeklyLossBp: z.number().int().min(100).max(2000),
    martingale: z.boolean(),
    martingaleSteps: z.number().int().min(1).max(5),
    newsBlocked: z.boolean(),
    wickRatio: z.number().min(0.2).max(2),
    decidedGapBp: z.number().int().min(20).max(200),
    presets: z.record(presetSchema),
  })
  .strict()
  .superRefine((v, ctx) => {
    const keys = PAIRS.flatMap((p) => [`${p}:300`, `${p}:900`]);
    if (Object.keys(v.presets).length !== 12 || keys.some((k) => !v.presets[k]))
      ctx.addIssue({
        code: "custom",
        message: "All twelve pair/window settings are required.",
      });
    if (v.weeklyLossBp < v.dailyLossBp)
      ctx.addIssue({
        code: "custom",
        message: "Weekly loss limit must cover the daily limit.",
      });
    if (v.setupBRiskBp > v.riskBp)
      ctx.addIssue({
        code: "custom",
        message: "Setup B must use the smaller risk allocation.",
      });
  });
export type Config = z.infer<typeof configSchema>;
export type Preset = z.infer<typeof presetSchema>;
export const DEFAULT_CONFIG: Config = {
  bankrollCents: 100000,
  riskBp: 100,
  setupB: false,
  setupBRiskBp: 35,
  dailyLossBp: 300,
  weeklyLossBp: 800,
  martingale: false,
  martingaleSteps: 3,
  newsBlocked: false,
  wickRatio: 0.6,
  decidedGapBp: 60,
  presets: Object.fromEntries(
    PAIRS.flatMap((p, i) =>
      [300, 900].map((w) => [
        `${p}:${w}`,
        {
          enabled: true,
          crowdBp: 10,
          crowdSeconds: w === 300 ? 45 : 60,
          leadBp: [12, 14, 16, 18, 20, 22][i],
          holdSeconds: w === 300 ? Math.min(12, 7 + i) : Math.min(12, 9 + i),
          holdBufferBp: 2,
          clearBufferBp: 3,
          flattenSeconds: w === 300 ? 15 : 25,
        },
      ]),
    ),
  ),
};
export function configOf(value: string | Config): Config {
  return configSchema.parse(
    typeof value === "string" ? JSON.parse(value) : value,
  );
}
