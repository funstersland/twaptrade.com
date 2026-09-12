import { z } from "zod";
import { configSchema, DEFAULT_CONFIG, type Config } from "./config.ts";
import { marketSchema, type Market } from "./market.ts";
import { type Horizon, type Direction } from "./identity.ts";
import { entryWindow, nextStake, type Signal } from "./rules.ts";
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const orderId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const fillSchema = z
  .object({
    id: z.string().max(200),
    orderId,
    side: z.literal("BUY"),
    tokenId: z.string().regex(/^\d{1,100}$/),
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    logIndex: amount,
    blockNumber: amount,
    grossMicros: amount,
    sharesMicros: amount.positive(),
    feeMicros: amount,
    cashMicros: amount.positive(),
    price: z.string().max(50),
    tradeIds: z.array(z.string().max(200)).max(100),
  })
  .strict();
export type Fill = z.infer<typeof fillSchema>;
export type Position = {
  id: string;
  market: Market;
  direction: Direction;
  stakeCents: number;
  status: "prepared" | "submitting" | "uncertain" | "open";
  orderId: string | null;
  costMicros: number;
  sharesMicros: number;
  feeMicros: number;
  fills: Fill[];
  signal: Signal;
  openedAt: number;
};
export type Closed = Position & {
  closedAt: number;
  winner: Direction;
  pnlMicros: number;
  payoutMicros: number;
};
export type State = {
  mode: "paper" | "live";
  armed: boolean;
  config: Config;
  configVersion: number;
  confirmedVersion: number | null;
  cashMicros: number;
  positions: Position[];
  lastAttempt: Record<Horizon, number>;
  lossStreaks: Record<Horizon, number>;
  pnlMicros: number;
  peakPnlMicros: number;
  maxDrawdownMicros: number;
  maxLosingStreak: number;
  losingStreak: number;
  winningStreak: number;
  maxWinningStreak: number;
  wins: number;
  losses: number;
  trades: number;
  daily: { day: string; pnlMicros: number };
  connection: {
    at: number;
    approved: boolean;
    balanceMicros: number | null;
    message: string;
  };
  message: string;
};
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), config: configSchema }).strict(),
  z.object({ action: z.literal("arm"), confirmVersion: amount }).strict(),
  z.object({ action: z.literal("disarm") }).strict(),
  z.object({ action: z.literal("window"), horizon: z.union([z.literal(300), z.literal(900), z.literal(3600)]), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("connection"),
      approved: z.boolean(),
      balanceMicros: amount.nullable(),
      message: z.string().max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("prepare"),
      market: marketSchema,
      direction: z.enum(["Up", "Down"]),
      stakeCents: amount.positive(),
      orderId: orderId.nullable(),
    })
    .strict(),
  z
    .object({ action: z.literal("submit"), positionId: z.string().uuid() })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      positionId: z.string().uuid(),
      costMicros: amount.positive(),
      sharesMicros: amount.positive(),
      feeMicros: amount,
      fills: z.array(fillSchema).max(200),
    })
    .strict(),
  z
    .object({
      action: z.enum(["unfilled", "uncertain"]),
      positionId: z.string().uuid(),
      reason: z.string().max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve"),
      positionId: z.string().uuid(),
      winner: z.enum(["Up", "Down"]),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export function initialState(
  mode: State["mode"],
  config = DEFAULT_CONFIG,
): State {
  return {
    mode,
    armed: false,
    config: configSchema.parse(config),
    configVersion: 1,
    confirmedVersion: null,
    cashMicros: mode === "paper" ? config.bankrollCents * 10000 : 0,
    positions: [],
    lastAttempt: { 300: 0, 900: 0, 3600: 0 },
    lossStreaks: { 300: 0, 900: 0, 3600: 0 },
    pnlMicros: 0,
    peakPnlMicros: 0,
    maxDrawdownMicros: 0,
    maxLosingStreak: 0,
    losingStreak: 0,
    winningStreak: 0,
    maxWinningStreak: 0,
    wins: 0,
    losses: 0,
    trades: 0,
    daily: { day: "", pnlMicros: 0 },
    connection: {
      at: 0,
      approved: false,
      balanceMicros: null,
      message: "Wallet not connected",
    },
    message: "ARM off. Strategy performance is unproven.",
  };
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
export function entryGate(
  s: State,
  market: Market,
  now: number,
  liveAllowed: boolean,
) {
  check(s.armed, "ARM is off");
  check(
    !s.positions.some((p) => p.status !== "open"),
    "Reconcile the unconfirmed order before any new entry",
  );
  check(s.config.horizons.includes(market.horizon), "Timeframe disabled");
  check(
    entryWindow(now, market.start, market.horizon),
    "Only the next round before T-20 is eligible",
  );
  check(market.accepting && !market.winner, "Market is not accepting orders");
  check(
    s.lastAttempt[market.horizon] < market.start,
    "This round already has an entry attempt",
  );
  check(
    s.positions.filter((p) => p.market.horizon === market.horizon).length < 2,
    "Two unresolved positions already occupy this timeframe",
  );
  const stake = nextStake(s.config);
  check(stake !== null, "Maximum stake limit reached");
  const exposed = s.positions.reduce(
    (n, p) => n + (p.costMicros || p.stakeCents * 10000),
    0,
  );
  const dailyLoss = Math.max(
    0,
    -(s.daily.day === new Date(now).toISOString().slice(0, 10)
      ? s.daily.pnlMicros
      : 0),
  );
  check(
    exposed + stake * 10000 + dailyLoss <=
      s.config.bankrollCents * s.config.dailyLossBp,
    "Daily loss/exposure limit reached",
  );
  if (s.mode === "live") {
    check(liveAllowed, "Live trading is not currently available");
    check(
      s.confirmedVersion === s.configVersion,
      "Review current settings before live ARM",
    );
    check(
      s.connection.approved && now - s.connection.at < 45000,
      "Wallet approval or balance check is stale",
    );
  }
  const available =
    s.mode === "paper" ? s.cashMicros : s.connection.balanceMicros;
  const reserved = s.positions
    .filter((p) => p.status !== "open")
    .reduce((n, p) => n + p.stakeCents * 10000, 0);
  check(
    available !== null && available - reserved >= stake * 10000,
    "Insufficient available cash",
  );
  return stake;
}
export function reduce(
  state: State,
  command: Command,
  now: number,
  context: { liveAllowed?: boolean; signal?: Signal; positionId?: string } = {},
) {
  const c = commandSchema.parse(command),
    s = structuredClone(state);
  let closed: Closed | null = null;
  const day = new Date(now).toISOString().slice(0, 10);
  if (s.daily.day !== day) s.daily = { day, pnlMicros: 0 };
  if (c.action === "configure") {
    check(
      !s.armed && !s.positions.length,
      "Disarm and resolve positions before editing settings",
    );
    check(
      s.trades === 0 || c.config.bankrollCents === s.config.bankrollCents,
      "Bankroll cannot be reset after trading",
    );
    s.config = c.config;
    s.configVersion++;
    s.confirmedVersion = null;
    if (s.mode === "paper" && s.trades === 0)
      s.cashMicros = c.config.bankrollCents * 10000;
  } else if (c.action === "window") {
    s.config.horizons = c.enabled ? [...new Set([...s.config.horizons,c.horizon])].sort((a,b)=>a-b) : s.config.horizons.filter(h=>h!==c.horizon);
    // Only this member-controlled entry switch changes; no risk limits or ARM are raised.
    s.configVersion++;
    if (s.confirmedVersion !== null) s.confirmedVersion = s.configVersion;
    s.message = `${c.horizon/60}m entries ${c.enabled ? "enabled" : "disabled"}. Existing positions still reconcile`;
  } else if (c.action === "arm") {
    check(c.confirmVersion === s.configVersion, "Review the latest settings");
    check(s.config.horizons.length, "Enable at least one trading window");
    check(
      !s.positions.some((p) => p.status !== "open"),
      "Resolve the uncertain order before rearming",
    );
    if (s.mode === "live")
      check(
        context.liveAllowed &&
          s.connection.approved &&
          now - s.connection.at < 45000,
        "Live wallet, geography or runner checks are incomplete",
      );
    s.armed = true;
    s.confirmedVersion = c.confirmVersion;
    s.message = "Waiting for a qualified forecast before T-20";
  } else if (c.action === "disarm") {
    s.armed = false;
    s.message = "ARM off. Existing orders and settlements still reconcile";
  } else if (c.action === "connection") {
    s.connection = {
      at: now,
      approved: c.approved,
      balanceMicros: c.balanceMicros,
      message: c.message,
    };
  } else if (c.action === "prepare") {
    check(
      c.stakeCents === entryGate(s, c.market, now, !!context.liveAllowed),
      "Stake changed",
    );
    check(
      context.signal?.direction === c.direction,
      "Forecast is not confirmed",
    );
    check(context.positionId, "Missing position identity");
    check(
      s.mode === "paper" ? c.orderId === null : c.orderId !== null,
      "Order mode mismatch",
    );
    s.lastAttempt[c.market.horizon] = c.market.start;
    s.positions.push({
      id: context.positionId,
      market: c.market,
      direction: c.direction,
      stakeCents: c.stakeCents,
      status: "prepared",
      orderId: c.orderId,
      costMicros: 0,
      sharesMicros: 0,
      feeMicros: 0,
      fills: [],
      signal: context.signal!,
      openedAt: now,
    });
    s.message = "Entry reserved for the upcoming round";
  } else {
    const p = s.positions.find((p) => p.id === c.positionId);
    check(p, "Position is no longer pending");
    if (c.action === "submit") {
      check(s.armed && p.status === "prepared" && s.config.horizons.includes(p.market.horizon), "Order cannot be submitted");
      check(
        entryWindow(now, p.market.start, p.market.horizon),
        "Submission deadline missed",
      );
      if (s.mode === "live")
        check(
          context.liveAllowed &&
            s.connection.approved &&
            now - s.connection.at < 45000 &&
            s.confirmedVersion === s.configVersion,
          "Live gate closed",
        );
      p.status = "submitting";
    } else if (c.action === "uncertain") {
      check(p.status !== "open", "Filled position cannot become unfilled");
      p.status = "uncertain";
      s.armed = false;
      s.message = c.reason;
    } else if (c.action === "unfilled") {
      check(p.status !== "open", "Filled position cannot become unfilled");
      s.positions = s.positions.filter((x) => x.id !== p.id);
      s.message = c.reason;
    } else if (c.action === "fill") {
      check(
        ["submitting", "uncertain"].includes(p.status),
        "No submitted order to fill",
      );
      if (s.mode === "paper")
        check(
          entryWindow(now, p.market.start, p.market.horizon),
          "Paper execution deadline missed",
        );
      check(
        c.costMicros <= p.stakeCents * 10000 && c.feeMicros < c.costMicros,
        "Fill exceeds the reserved stake",
      );
      if (s.mode === "live") {
        check(
          c.fills.length > 0 &&
            new Set(c.fills.map((f) => f.id)).size === c.fills.length,
          "Confirmed executions required",
        );
        check(
          c.fills.every(
            (f) =>
              f.orderId === p.orderId &&
              f.tokenId ===
                (p.direction === "Up"
                  ? p.market.upToken
                  : p.market.downToken) &&
              f.cashMicros === f.grossMicros + f.feeMicros &&
              f.id === `${f.transactionHash.toLowerCase()}:${f.logIndex}`,
          ),
          "Execution identity mismatch",
        );
        for (const [summary, key] of [
          [c.costMicros, "cashMicros"],
          [c.sharesMicros, "sharesMicros"],
          [c.feeMicros, "feeMicros"],
        ] as const)
          check(
            c.fills.reduce((n, f) => n + f[key], 0) === summary,
            "Execution totals mismatch",
          );
        s.connection.at = 0;
      } else {
        check(c.fills.length === 0, "Paper cannot contain live executions");
        s.cashMicros -= c.costMicros;
      }
      p.status = "open";
      p.costMicros = c.costMicros;
      p.sharesMicros = c.sharesMicros;
      p.feeMicros = c.feeMicros;
      p.fills = c.fills;
      s.message = "Holding this round until confirmed resolution";
    } else if (c.action === "resolve") {
      check(
        p.status === "open" && now >= p.market.end * 1000,
        "Wait for a filled position and confirmed resolution",
      );
      const payoutMicros = p.direction === c.winner ? p.sharesMicros : 0,
        pnlMicros = payoutMicros - p.costMicros;
      closed = {
        ...p,
        closedAt: now,
        winner: c.winner,
        payoutMicros,
        pnlMicros,
      };
      s.positions = s.positions.filter((x) => x.id !== p.id);
      if (s.mode === "paper") s.cashMicros += payoutMicros;
      s.pnlMicros += pnlMicros;
      s.daily.pnlMicros += pnlMicros;
      s.trades++;
      s.peakPnlMicros = Math.max(s.peakPnlMicros, s.pnlMicros);
      s.maxDrawdownMicros = Math.max(
        s.maxDrawdownMicros,
        s.peakPnlMicros - s.pnlMicros,
      );
      if (pnlMicros < 0) {
        s.losses++;
        s.lossStreaks[p.market.horizon]++;
        s.losingStreak++;
        s.winningStreak = 0;
      } else {
        s.lossStreaks[p.market.horizon] = 0;
        s.losingStreak = 0;
        if (pnlMicros > 0) {
          s.wins++;
          s.winningStreak++;
        } else s.winningStreak = 0;
      }
      s.maxLosingStreak = Math.max(s.maxLosingStreak, s.losingStreak);
      s.maxWinningStreak = Math.max(s.maxWinningStreak, s.winningStreak);
      s.message =
        "Round resolved. Live proceeds may still require redemption in Polymarket";
    }
  }
  return { state: s, closed };
}
