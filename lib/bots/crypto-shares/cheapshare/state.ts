import { z } from "zod";
import { configSchema, DEFAULT_CONFIG, type Config } from "./config.ts";
import {
  riskAllowed,
  stake,
  utcPeriods,
  scan,
  buyQuote,
  sellQuote,
  type ScanInput,
} from "./rules.ts";
import { PAIRS, type Direction } from "./identity.ts";
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const price = z.string().regex(/^\d{1,40}$/);
export const marketSchema = z
  .object({
    slug: z.string().max(100),
    pair: z.enum(PAIRS),
    window: z.union([z.literal(300), z.literal(900)]),
    start: amount,
    end: amount,
    conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    upToken: price,
    downToken: price,
    strike: price,
    strikeSource: z.enum(["gamma", "chainlink-open"]),
    feeRate: z.number().min(0).max(0.5),
    feeExponent: z.number().min(0).max(5),
  })
  .strict()
  .refine(
    (m) =>
      m.end === m.start + m.window &&
      m.start % m.window === 0 &&
      m.slug === `${m.pair.toLowerCase()}-updown-${m.window / 60}m-${m.start}`,
    "Invalid market window",
  );
export type Market = z.infer<typeof marketSchema>;
export type Fill = {
  id: string;
  orderId: string;
  side: "BUY" | "SELL";
  tokenId: string;
  transactionHash: string | null;
  logIndex: number;
  blockNumber: number;
  grossMicros: number;
  sharesMicros: number;
  feeMicros: number;
  cashMicros: number;
  price: string;
  tradeIds: string[];
};
export type Order = {
  id: string;
  side: "BUY" | "SELL";
  purpose: string;
  limit: number;
  amount: number;
  status: "prepared" | "submitting" | "uncertain";
  createdAt: number;
};
export type Position = {
  id: string;
  market: Market;
  side: Direction;
  setup: "A" | "B";
  stake: number;
  cost: number;
  shares: number;
  sold: number;
  proceeds: number;
  fees: number;
  stage55: boolean;
  stage75: boolean;
  order: Order | null;
  fills: Fill[];
  openedAt: number;
  closedAt: number | null;
  pnl: number | null;
  winner: Direction | null;
  closeReason: string | null;
  mark: number | null;
  inventoryError: boolean;
};
export type State = {
  mode: "paper" | "live";
  armed: boolean;
  config: Config;
  configVersion: number;
  confirmedVersion: number | null;
  cash: number;
  initialCash: number;
  positions: Position[];
  seenMarkets: { slug: string; end: number }[];
  lossStreak: number;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  daily: { key: string; pnl: number };
  weekly: { key: string; pnl: number };
  connection: {
    status: string;
    at: number;
    balance: number | null;
    message: string;
  };
  message: string;
  scan: unknown[];
};
export function initialState(
  mode: "paper" | "live",
  config = DEFAULT_CONFIG,
): State {
  return {
    mode,
    armed: false,
    config: configSchema.parse(config),
    configVersion: 1,
    confirmedVersion: null,
    cash: mode === "paper" ? config.bankrollCents * 10000 : 0,
    initialCash: mode === "paper" ? config.bankrollCents * 10000 : 0,
    positions: [],
    seenMarkets: [],
    lossStreak: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
    daily: { key: "", pnl: 0 },
    weekly: { key: "", pnl: 0 },
    connection: { status: "disconnected", at: 0, balance: null, message: "" },
    message: "ARM is off.",
    scan: [],
  };
}
export function limits(s: State, now: number) {
  const p = utcPeriods(now);
  return {
    day: s.daily.key === p.day ? s.daily.pnl : 0,
    week: s.weekly.key === p.week ? s.weekly.pnl : 0,
    open: s.positions.reduce(
      (n, p) => n + Math.max(0, (p.cost || p.stake) - p.proceeds),
      0,
    ),
    cash:
      (s.mode === "paper" ? s.cash : (s.connection.balance ?? 0)) -
      s.positions
        .filter((p) => p.order?.side === "BUY")
        .reduce((n, p) => n + p.stake, 0),
  };
}
export function canEnter(s: State, amount: number, now: number) {
  const l = limits(s, now);
  return (
    riskAllowed(
      s.config,
      amount,
      l.open,
      l.cash,
      l.day,
      l.week,
      s.positions.length,
    ) &&
    !s.positions.some(
      (p) => p.inventoryError || p.order?.status === "uncertain",
    )
  );
}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
export function active(s: State, now: number, liveAllowed: boolean) {
  check(s.armed, "ARM is off.");
  if (s.mode === "live") {
    check(
      liveAllowed,
      "Live execution is unavailable in this region or the feed is offline.",
    );
    check(
      s.confirmedVersion === s.configVersion,
      "Confirm the current live settings first.",
    );
    check(
      s.connection.status === "connected" && now - s.connection.at < 45000,
      "Wallet verification is stale.",
    );
  }
}
const fillSchema = z
  .object({
    id: z.string().max(200),
    orderId: z.string().max(100),
    side: z.enum(["BUY", "SELL"]),
    tokenId: price,
    transactionHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
    logIndex: amount,
    blockNumber: amount,
    grossMicros: amount,
    sharesMicros: amount,
    feeMicros: amount,
    cashMicros: amount,
    price: z.string().regex(/^\d+\.\d+$/),
    tradeIds: z.array(z.string().max(100)).max(200),
  })
  .strict();
const level = z
  .object({
    price: z.string().regex(/^\d+(\.\d+)?$/),
    size: z.string().regex(/^\d+(\.\d+)?$/),
  })
  .strict();
const book = z
  .object({
    at: amount,
    bids: z.array(level).max(1000),
    asks: z.array(level).max(1000),
  })
  .strict();
export const observationSchema = z
  .object({
    now: amount,
    end: amount,
    strike: price.nullable(),
    twap: z.array(z.object({ at: amount, value: price }).strict()).max(500),
    spot: z
      .array(z.object({ at: amount, bid: price, ask: price }).strict())
      .max(10000),
    up: book,
    down: book,
  })
  .strict();
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), config: configSchema }).strict(),
  z
    .object({ action: z.literal("arm"), confirmVersion: amount.nullable() })
    .strict(),
  z.object({ action: z.literal("disarm") }).strict(),
  z
    .object({
      action: z.literal("connection"),
      status: z.enum(["connected", "error"]),
      balance: amount.nullable(),
      message: z.string().max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("scan"),
      rows: z.array(z.unknown()).max(12),
      message: z.string().max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("entry"),
      positionId: z.string().uuid(),
      market: marketSchema,
      observation: observationSchema,
      orderId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("exit"),
      positionId: z.string().uuid(),
      orderId: z.string().min(1).max(100),
      purpose: z.enum(["scale55", "scale75", "take88", "emergency", "time"]),
      limit: z.number().min(0.001).max(0.99),
      shares: amount,
      observation: observationSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("submit"),
      positionId: z.string().uuid(),
      orderId: z.string().max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      positionId: z.string().uuid(),
      orderId: z.string().max(100),
      fills: z.array(fillSchema).min(1).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("unfilled"),
      positionId: z.string().uuid(),
      orderId: z.string().max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("uncertain"),
      positionId: z.string().uuid(),
      orderId: z.string().max(100),
    })
    .strict(),
  z
    .object({ action: z.literal("inventory"), positionId: z.string().uuid() })
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
import { directionSign, held, project, top } from "./rules.ts";
export function exitSignal(
  p: Position,
  i: Omit<ScanInput, "preset" | "config">,
  config: Config,
) {
  const t = i.twap.at(-1),
    b = i.spot.at(-1),
    book = p.side === "Up" ? i.up : i.down,
    now = i.now,
    preset = config.presets[`${p.market.pair}:${p.market.window}`];
  if (
    !t ||
    !b ||
    now - t.at > 3000 ||
    now - b.at > 1500 ||
    now - book.at > 3000 ||
    t.at > now ||
    b.at > now ||
    book.at > now + 500 ||
    i.end <= now ||
    i.strike !== p.market.strike
  )
    return null;
  const clear = project(
    t.value,
    p.side === "Up" ? b.bid : b.ask,
    p.market.strike,
    p.side,
    i.end - now,
    preset.clearBufferBp,
  ).clear;
  const opposite: Direction = p.side === "Up" ? "Down" : "Up";
  const back = held(
    i.spot.map((q) => ({ at: q.at, value: p.side === "Up" ? q.ask : q.bid })),
    now,
    3000,
    (x) =>
      (BigInt(x.value) - BigInt(p.market.strike)) * directionSign(opposite) >
      0n,
    1500,
  );
  const remaining = p.shares - p.sold,
    bid = top(book.bids, "bid");
  if (bid === null || remaining <= 0) return null;
  const signal = (
    purpose: "scale55" | "scale75" | "take88" | "emergency" | "time",
    shares: number,
    min: number,
  ) => ({ purpose, shares: Math.min(remaining, shares), min });
  if (!clear || back) return signal("emergency", remaining, 0.001);
  if (
    i.end - now <= preset.flattenSeconds * 1000 &&
    (BigInt(t.value) - BigInt(p.market.strike)) * directionSign(p.side) < 0n
  )
    return signal("time", remaining, 0.001);
  if (!p.stage55 && bid >= 0.55)
    return signal("scale55", Math.floor(p.shares * 0.4), 0.55);
  if (!p.stage75 && bid >= 0.75)
    return signal("scale75", Math.floor(p.shares * 0.3), 0.75);
  if (bid >= 0.88 && clear) return signal("take88", remaining, 0.88);
  return null;
}
export function reduce(
  state: State,
  raw: Command,
  now: number,
  liveAllowed = false,
) {
  const c = commandSchema.parse(raw),
    s = structuredClone(state);
  let closed: Position | null = null;
  const periods = utcPeriods(now);
  if (s.daily.key !== periods.day) s.daily = { key: periods.day, pnl: 0 };
  if (s.weekly.key !== periods.week) s.weekly = { key: periods.week, pnl: 0 };
  const close = (p: Position, reason: string) => {
    p.closedAt = now;
    p.closeReason = reason;
    p.pnl = p.proceeds - p.cost;
    s.trades++;
    s.pnl += p.pnl;
    s.daily.pnl += p.pnl;
    s.weekly.pnl += p.pnl;
    if (p.pnl > 0) {
      s.wins++;
      s.lossStreak = 0;
    } else if (p.pnl < 0) {
      s.losses++;
      s.lossStreak++;
    }
    s.positions = s.positions.filter((x) => x.id !== p.id);
    closed = p;
  };
  switch (c.action) {
    case "configure":
      check(
        !s.armed && !s.positions.length,
        "Disarm and close open positions before changing settings.",
      );
      check(
        s.trades === 0 || s.config.bankrollCents === c.config.bankrollCents,
        "Bankroll cannot be reset after trading.",
      );
      s.config = c.config;
      s.configVersion++;
      s.confirmedVersion = null;
      if (s.trades === 0 && s.mode === "paper")
        s.cash = s.initialCash = c.config.bankrollCents * 10000;
      break;
    case "arm":
      if (s.mode === "live") {
        check(
          c.confirmVersion === s.configVersion,
          "Review and confirm the current live configuration.",
        );
        s.confirmedVersion = c.confirmVersion;
      }
      s.armed = true;
      active(s, now, liveAllowed);
      s.message = "Watching for a qualified fade.";
      break;
    case "disarm":
      s.armed = false;
      s.confirmedVersion = null;
      s.message = "ARM is off. No new buy or sell orders.";
      break;
    case "connection":
      s.connection = {
        status: c.status,
        at: now,
        balance: c.balance,
        message: c.message,
      };
      break;
    case "scan":
      s.scan = c.rows;
      s.message = c.message;
      break;
    case "entry": {
      active(s, now, liveAllowed);
      check(!s.config.newsBlocked, "News block is on.");
      const m = c.market;
      check(
        now >= m.start * 1000 &&
          now < m.end * 1000 &&
          c.observation.end === m.end * 1000 &&
          c.observation.strike === m.strike,
        "Market or strike mismatch.",
      );
      check(
        Math.abs(now - c.observation.now) <= 2000,
        "Entry observation expired.",
      );
      const result = scan({
        ...c.observation,
        now,
        preset: s.config.presets[`${m.pair}:${m.window}`],
        config: s.config,
      });
      check(result.eligible && result.side && result.setup, result.reason);
      const budget = stake(s.config, result.setup, s.lossStreak);
      check(
        budget && canEnter(s, budget, now),
        "Concurrent position, liquidity or loss limit reached.",
      );
      s.seenMarkets = s.seenMarkets.filter((x) => x.end * 1000 > now - 900000);
      check(
        !s.seenMarkets.some((x) => x.slug === m.slug),
        "This window was already traded.",
      );
      const limit = result.setup === "A" ? 0.28 : 0.12,
        book = result.side === "Up" ? c.observation.up : c.observation.down;
      check(
        buyQuote(book.asks, budget, limit, m.feeRate, m.feeExponent),
        "Insufficient ask depth within the price band.",
      );
      s.positions.push({
        id: c.positionId,
        market: m,
        side: result.side,
        setup: result.setup,
        stake: budget,
        cost: 0,
        shares: 0,
        sold: 0,
        proceeds: 0,
        fees: 0,
        stage55: false,
        stage75: false,
        order: {
          id: c.orderId,
          side: "BUY",
          purpose: "entry",
          limit,
          amount: budget,
          status: "prepared",
          createdAt: now,
        },
        fills: [],
        openedAt: now,
        closedAt: null,
        pnl: null,
        winner: null,
        closeReason: null,
        mark: null,
        inventoryError: false,
      });
      s.seenMarkets.push({ slug: m.slug, end: m.end });
      break;
    }
    default: {
      const p = s.positions.find((p) => p.id === c.positionId);
      check(p, "Position not found.");
      if (c.action === "inventory") {
        p.inventoryError = true;
        s.message =
          "Wallet inventory is below CheapShare-owned shares. Reconciliation required.";
        break;
      }
      if (c.action === "resolve") {
        check(
          now >= p.market.end * 1000 &&
            !p.order &&
            p.shares > 0 &&
            !p.inventoryError,
          "Position is not ready for settlement.",
        );
        p.winner = c.winner;
        const payout = c.winner === p.side ? p.shares - p.sold : 0;
        p.proceeds += payout;
        if (s.mode === "paper") s.cash += payout;
        close(p, "resolution");
        break;
      }
      if (c.action === "exit") {
        active(s, now, liveAllowed);
        check(
          !p.order && !p.inventoryError,
          "Position has an outstanding order or inventory mismatch.",
        );
        check(
          Math.abs(now - c.observation.now) <= 2000 &&
            c.observation.end === p.market.end * 1000,
          "Exit observation expired.",
        );
        const signal = exitSignal(p, { ...c.observation, now }, s.config);
        check(
          signal &&
            signal.purpose === c.purpose &&
            c.shares === signal.shares &&
            c.limit >= signal.min,
          "Exit rule is not satisfied.",
        );
        const book = p.side === "Up" ? c.observation.up : c.observation.down;
        check(
          sellQuote(
            book.bids,
            c.shares,
            c.limit,
            p.market.feeRate,
            p.market.feeExponent,
          ),
          "Insufficient exit depth.",
        );
        p.order = {
          id: c.orderId,
          side: "SELL",
          purpose: c.purpose,
          limit: c.limit,
          amount: c.shares,
          status: "prepared",
          createdAt: now,
        };
        break;
      }
      const o = p.order;
      check(o && o.id === c.orderId, "Order does not belong to this position.");
      if (c.action === "submit") {
        active(s, now, liveAllowed);
        check(
          o.status === "prepared" &&
            now - o.createdAt <= 2000 &&
            now < p.market.end * 1000,
          "Order expired or already submitted.",
        );
        o.status = "submitting";
        break;
      }
      if (c.action === "uncertain") {
        check(
          o.status !== "prepared",
          "Unsubmitted order cannot have an unknown outcome.",
        );
        o.status = "uncertain";
        break;
      }
      if (c.action === "unfilled") {
        if (o.side === "BUY")
          s.positions = s.positions.filter((x) => x.id !== p.id);
        else p.order = null;
        break;
      }
      if (c.action === "fill") {
        check(o.status !== "prepared", "Order was not submitted.");
        const ids = new Set<string>();
        let cash = 0,
          shares = 0,
          fee = 0;
        for (const f of c.fills) {
          check(
            f.orderId.toLowerCase() === o.id.toLowerCase() &&
              f.side === o.side &&
              f.tokenId ===
                (p.side === "Up" ? p.market.upToken : p.market.downToken),
            "Fill attribution mismatch.",
          );
          check(
            !ids.has(f.id) && !p.fills.some((x) => x.id === f.id),
            "Duplicate fill.",
          );
          ids.add(f.id);
          check(
            f.cashMicros ===
              f.grossMicros + (o.side === "BUY" ? f.feeMicros : -f.feeMicros) &&
              f.sharesMicros > 0,
            "Invalid fill amounts.",
          );
          check(
            s.mode === "paper"
              ? f.transactionHash === null
              : !!f.transactionHash &&
                  f.id === `${f.transactionHash.toLowerCase()}:${f.logIndex}`,
            "Invalid execution evidence.",
          );
          cash += f.cashMicros;
          shares += f.sharesMicros;
          fee += f.feeMicros;
          check(
            o.side === "BUY"
              ? BigInt(f.grossMicros) * 1000000n <=
                  BigInt(f.sharesMicros) *
                    BigInt(Math.round(o.limit * 1000000)) +
                    1000000n
              : BigInt(f.grossMicros) * 1000000n + 1000000n >=
                  BigInt(f.sharesMicros) *
                    BigInt(Math.round(o.limit * 1000000)),
            "Fill violates the signed price limit.",
          );
        }
        check(
          [cash, shares, fee].every(Number.isSafeInteger),
          "Execution exceeds supported precision.",
        );
        if (o.side === "BUY") {
          check(
            cash <= p.stake && p.shares === 0,
            "Entry exceeds the reserved budget.",
          );
          p.cost = cash;
          p.shares = shares;
          if (s.mode === "paper") {
            check(s.cash >= cash, "Insufficient paper cash.");
            s.cash -= cash;
          }
        } else {
          check(
            shares <= o.amount && shares <= p.shares - p.sold,
            "Sale exceeds CheapShare-owned shares.",
          );
          p.sold += shares;
          p.proceeds += cash;
          if (s.mode === "paper") s.cash += cash;
          if (o.purpose === "scale55") p.stage55 = true;
          if (o.purpose === "scale75") p.stage75 = true;
        }
        p.fees += fee;
        p.fills.push(...c.fills);
        p.order = null;
        if (o.side === "SELL" && p.sold === p.shares) close(p, o.purpose);
        // A changed wallet balance must be fetched before another live entry.
        if (s.mode === "live") s.connection.at = 0;
      }
    }
  }
  return { state: s, closed };
}
