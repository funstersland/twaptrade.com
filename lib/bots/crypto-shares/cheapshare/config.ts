import { z } from "zod";
import { PAIRS } from "./identity.ts";
export const presetSchema = z.object({
  enabled: z.boolean(),
  leaderSeconds: z.number().int().min(3).max(60),
  impulseSeconds: z.number().int().min(3).max(15),
  impulseMultiple: z.number().min(1.25).max(10),
  holdSeconds: z.number().int().min(1).max(10),
  clearBufferBp: z.number().min(0.05).max(20),
  maxModelErrorBp: z.number().min(0.05).max(5),
  retreatPct: z.number().min(10).max(75),
  timeBufferSeconds: z.number().int().min(2).max(10),
  exitHeadroomPct: z.number().int().min(10).max(90),
}).strict().refine(p => p.holdSeconds < p.impulseSeconds, "Spot hold must fit inside the impulse window.");
export const configSchema = z.object({
  bankrollCents: z.number().int().min(10000).max(100000000),
  tradeBudgetCents: z.number().int().min(100).max(1000000),
  riskBp: z.number().int().min(1).max(200),
  profitTargetBp: z.number().int().min(100).max(100000),
  minimumUpsideBp: z.number().int().min(100).max(10000),
  maximumEntryLossBp: z.number().int().min(100).max(3000),
  dailyLossBp: z.number().int().min(100).max(1000),
  weeklyLossBp: z.number().int().min(100).max(2000),
  newsBlocked: z.boolean(),
  presets: z.record(presetSchema),
}).strict().superRefine((v, ctx) => {
  const keys = PAIRS.flatMap(p => [`${p}:300`, `${p}:900`]);
  if (Object.keys(v.presets).length !== keys.length || keys.some(k => !v.presets[k]))
    ctx.addIssue({ code: "custom", message: "All twelve pair/window settings are required." });
  if (v.weeklyLossBp < v.dailyLossBp)
    ctx.addIssue({ code: "custom", message: "Weekly loss limit must cover the daily limit." });
});
export type Config = z.infer<typeof configSchema>;
export type Preset = z.infer<typeof presetSchema>;
export const DEFAULT_CONFIG: Config = {
  bankrollCents: 100000,
  tradeBudgetCents: 1000,
  riskBp: 100,
  profitTargetBp: 2000,
  minimumUpsideBp: 1000,
  maximumEntryLossBp: 1000,
  dailyLossBp: 300,
  weeklyLossBp: 800,
  newsBlocked: false,
  presets: Object.fromEntries(PAIRS.flatMap(p => [300, 900].map(w => [`${p}:${w}`, {
    enabled: true,
    leaderSeconds: 5,
    impulseSeconds: 5,
    impulseMultiple: 2,
    holdSeconds: 2,
    clearBufferBp: 0.1,
    maxModelErrorBp: 0.5,
    retreatPct: 25,
    timeBufferSeconds: 3,
    exitHeadroomPct: 50,
  }]))),
};
export function configOf(value: string | Config): Config {
  return configSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}
