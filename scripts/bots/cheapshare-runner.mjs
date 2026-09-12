import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PAIRS } from "../../lib/bots/crypto-shares/cheapshare/identity.ts";
import {
  scan,
  stake,
  buyQuote,
  sellQuote,
  entryPlan,
  exitPlan,
} from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
import {
  canEnter,
  exitSignal,
} from "../../lib/bots/crypto-shares/cheapshare/state.ts";
import { Feeds, marketAt, orderBook } from "./cheapshare-market.mjs";
import {
  prepareBuy,
  prepareSell,
  connectionState,
  confirmedFill,
  walletShares,
  geographyAllowed,
} from "./cheapshare-live.mjs";
try {
  process.loadEnvFile(".dev.vars");
} catch {}
const origin =
    process.env.TWAP_CHEAPSHARE_APP_ORIGIN || "http://localhost:5173",
  base = new URL(origin);
if (
  base.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(base.hostname)
)
  throw Error("HTTPS required");
if (!process.env.TWAP_CHEAPSHARE_RUNNER_TOKEN)
  throw Error("CheapShare runner token is not configured");
const lease = randomUUID(),
  feeds = new Feeds(),
  cache = new Map(),
  references = new Map(),
  inventoryChecked = new Map();
let stopped = false,
  geoAllowed = false,
  geoAt = 0;
async function bridge(payload) {
  const r = await fetch(`${origin}/api/cheapshare/runner`, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.TWAP_CHEAPSHARE_RUNNER_TOKEN}`,
      "content-type": "application/json",
      "x-cheapshare-version": "2",
    },
    ...(payload ? { body: JSON.stringify({ ...payload, lease }) } : {}),
    signal: AbortSignal.timeout(6000),
  });
  const d = await r.json();
  if (!r.ok)
    throw Object.assign(Error(d.error || "Engine request failed"), {
      status: r.status,
    });
  return d;
}
async function command(run, c) {
  const eventId = randomUUID(),
    payload = {
      action: "command",
      runId: run.id,
      revision: run.revision,
      eventId,
      command: c,
    };
  let result;
  for (let n = 0; n < 3; n++) {
    try {
      result = await bridge(payload);
      break;
    } catch (e) {
      if ((e.status && e.status < 500) || n === 2) throw e;
      await sleep(100);
    }
  }
  if (result.duplicate)
    throw Object.assign(
      Error("Event already committed; refresh state before continuing"),
      { bridgeError: true },
    );
  run.state = result.state;
  run.revision = result.revision;
  return result;
}
async function market(pair, w, start) {
  const key = `${pair}:${w}:${start}`,
    old = cache.get(key);
  if (old && Date.now() - old.at < 10000) return old.value;
  const value = await marketAt(pair, w, start);
  cache.set(key, { at: Date.now(), value });
  for (const [k, v] of cache) if (v.at < Date.now() - 3600000) cache.delete(k);
  return value;
}
async function reconcile(run) {
  for (const p of [...run.state.positions]) {
    const o = p.order;
    try {
      if (o) {
        if (o.status === "prepared") {
          if (Date.now() - o.createdAt > 3000)
            await command(run, {
              action: "unfilled",
              positionId: p.id,
              orderId: o.id,
            });
          continue;
        }
        if (run.mode === "paper") {
          // A simulated submission has no external side effect; an interrupted one is safely unfilled.
          if (Date.now() - o.createdAt > 5000)
            await command(run, {
              action: "unfilled",
              positionId: p.id,
              orderId: o.id,
            });
          continue;
        }
        const token = p.side === "Up" ? p.market.upToken : p.market.downToken;
        const f = await confirmedFill(
          run,
          {
            condition_id: p.market.conditionId,
            start_seconds: p.market.start,
            token_id: token,
            stake_micros: p.stake,
          },
          o.side,
          o.id,
        );
        if (f?.unfilled)
          await command(run, {
            action: "unfilled",
            positionId: p.id,
            orderId: o.id,
          });
        else if (f)
          await command(run, {
            action: "fill",
            positionId: p.id,
            orderId: o.id,
            fills: f.fills,
          });
        if (!f && o.status !== "uncertain" && Date.now() - o.createdAt > 15000)
          await command(run, {
            action: "uncertain",
            positionId: p.id,
            orderId: o.id,
          });
        continue;
      }
      if (
        run.mode === "live" &&
        !p.inventoryError &&
        Date.now() - (inventoryChecked.get(p.id) || 0) > 10000
      ) {
        inventoryChecked.set(p.id, Date.now());
        if (
          (await walletShares(
            run,
            p.side === "Up" ? p.market.upToken : p.market.downToken,
          )) <
          p.shares - p.sold
        ) {
          await command(run, { action: "inventory", positionId: p.id });
          continue;
        }
      }
      if (Date.now() >= p.market.end * 1000) {
        const m = await market(p.market.pair, p.market.window, p.market.start);
        if (m.winner && !p.inventoryError) {
          if (
            run.mode === "live" &&
            m.winner === p.side &&
            (await walletShares(
              run,
              p.side === "Up" ? m.upToken : m.downToken,
            )) <
              p.shares - p.sold
          ) {
            await command(run, { action: "inventory", positionId: p.id });
            continue;
          }
          await command(run, {
            action: "resolve",
            positionId: p.id,
            winner: m.winner,
          });
        }
      }
    } catch (error) {
      if (error.bridgeError) throw error;
      // One unavailable order/market must not starve another position's exits.
      if (o && o.status === "submitting" && Date.now() - o.createdAt > 15000)
        await command(run, {
          action: "uncertain",
          positionId: p.id,
          orderId: o.id,
        });
    }
  }
}
function simulatedFill(o, p, q) {
  return {
    id: `paper:${o.id}`,
    orderId: o.id,
    side: o.side,
    tokenId: p.side === "Up" ? p.market.upToken : p.market.downToken,
    transactionHash: null,
    logIndex: 0,
    blockNumber: 0,
    ...q,
    tradeIds: [],
  };
}
async function fire(run, c, prepared) {
  await command(run, c);
  const position = run.state.positions.find((p) => p.id === c.positionId),
    o = position.order;
  let submitted = false;
  try {
    // A last server gate observes member suspension, ARM, current version and region.
    if (run.mode === "live" && !(await geographyAllowed()))
      throw Error("Live trading unavailable in this region");
    await command(run, {
      action: "submit",
      positionId: position.id,
      orderId: o.id,
    });
    submitted = true;
    if (run.mode === "live") {
      // Never retry postOrder, including timeouts. Recovery only queries this signed hash.
      if (
        Date.now() - o.createdAt > 2500 ||
        Date.now() >= position.market.end * 1000
      )
        throw Error("Signed order expired before submission");
      await prepared.client.postOrder(prepared.signed);
    } else {
      const book = await orderBook(
          position.side === "Up"
            ? position.market.upToken
            : position.market.downToken,
        ),
        m = position.market;
      const fill =
        o.side === "BUY"
          ? buyQuote(book.asks, o.amount, o.limit, m.feeRate, m.feeExponent)
          : sellQuote(book.bids, o.amount, o.limit, m.feeRate, m.feeExponent);
      if (!fill)
        await command(run, {
          action: "unfilled",
          positionId: position.id,
          orderId: o.id,
        });
      else
        await command(run, {
          action: "fill",
          positionId: position.id,
          orderId: o.id,
          fills: [simulatedFill(o, position, fill)],
        });
    }
  } catch (e) {
    if (submitted && run.mode === "live") {
      try {
        await command(run, {
          action: "uncertain",
          positionId: position.id,
          orderId: o.id,
        });
      } catch {}
    } else if (!submitted) {
      try {
        await command(run, {
          action: "unfilled",
          positionId: position.id,
          orderId: o.id,
        });
      } catch {}
    }
    throw e;
  }
}
async function tick() {
  if (Date.now() - geoAt > 60000) {
    geoAllowed = await geographyAllowed().catch(() => false);
    geoAt = Date.now();
  }
  const jobs = await bridge();
  if (Math.abs(Date.now() - jobs.now) > 1500)
    throw Error("Runner clock differs from server");
  for (const r of jobs.references) references.set(r.slug, r);
  const views = await Promise.all(
    PAIRS.flatMap((pair) =>
      [300, 900].map(async (w) => {
        const start = Math.floor(Date.now() / 1000 / w) * w,
          slug = `${pair.toLowerCase()}-updown-${w / 60}m-${start}`;
        try {
          const raw = await market(pair, w, start);
          let ref = references.get(slug);
          const opening = feeds.opening.get(`${pair}:${w}:${start}`),
            strike = raw.officialStrike || opening;
          if (ref && raw.officialStrike && ref.strike !== raw.officialStrike)
            throw Error("Official strike conflicts with the locked reference");
          if (!ref && strike) {
            ref = {
              slug,
              strike,
              source: raw.officialStrike ? "gamma" : "chainlink-open",
              locked_at: start * 1000,
            };
          }
          const m = {
            slug,
            pair,
            window: w,
            windowSeconds: raw.windowSeconds,
            start,
            end: raw.end,
            conditionId: raw.conditionId,
            upToken: raw.upToken,
            downToken: raw.downToken,
            feeRate: raw.feeRate,
            feeExponent: raw.feeExponent,
            strike: ref?.strike || null,
            strikeSource: ref?.source || "chainlink-open",
          };
          const [up, down] = await Promise.all([
            orderBook(m.upToken),
            orderBook(m.downToken),
          ]);
          return {
            pair,
            window: w,
            m,
            ref,
            books: { up, down },
            accepting: raw.accepting,
            error: !feeds.available.has(pair) && !(pair === "HYPE" && feeds.hypeAvailable)
              ? "Spot feed unavailable"
              : null,
          };
        } catch (e) {
          return { pair, window: w, error: e.message };
        }
      }),
    ),
  );
  await bridge({
    action: "heartbeat",
    geoAllowed,
    markets: views.map((v) => ({
      pair: v.pair,
      window: v.window,
      error: v.error,
      strike: v.m?.strike || null,
      strikeSource: v.ref?.source || null,
      twap: feeds.twap.get(v.pair)?.at(-1) || null,
      oracle: feeds.oracle.get(v.pair)?.at(-1) || null,
      windowSeconds: v.m?.windowSeconds || null,
      spotSource: v.pair === "HYPE" ? "Hyperliquid HYPE/USDC spot" : "Binance spot",
      spot: feeds.spot.get(v.pair)?.at(-1) || null,
      end: v.m?.end || null,
    })),
    message: geoAllowed
      ? ""
      : "Live trading is unavailable from this region. Paper mode remains available.",
  });
  for (const v of views)
    if (v.ref && !references.has(v.ref.slug)) {
      const d = await bridge({
        action: "reference",
        slug: v.ref.slug,
        strike: v.ref.strike,
        source: v.ref.source,
        observedAt: v.ref.locked_at,
      });
      references.set(v.ref.slug, d.reference);
      if (d.reference.strike !== v.m.strike)
        v.error = "Opening reference conflict";
    }
  for (const run of jobs.runs) {
    try {
      if (run.state.strategyVersion !== 2) continue;
      await reconcile(run);
      if (
        run.mode === "live" &&
        run.wallet_cipher &&
        Date.now() - run.state.connection.at >= 30000
      ) {
        try {
          const c = await connectionState(run);
          await command(run, {
            action: "connection",
            status: c.approved ? "connected" : "error",
            balance: c.balanceMicros,
            message: c.approved
              ? ""
              : "Complete token spending approvals on Polymarket.",
          });
        } catch (e) {
          if (e.status) throw e;
          await command(run, {
            action: "connection",
            status: "error",
            balance: null,
            message: "Wallet connection could not be verified.",
          });
        }
      }
      const rows = [];
      for (const v of views) {
        if (v.error || !v.m?.strike) {
          rows.push({
            pair: v.pair,
            window: v.window,
            reason: v.error || "Waiting for an exact opening Price-to-Beat",
            eligible: false,
          });
          continue;
        }
        const i = feeds.observation(v.m, v.books),
          s = run.state,
          config = s.config,
          result = scan({
            ...i,
            config,
            preset: config.presets[`${v.pair}:${v.window}`],
          });
        const budget = stake(config);
        const book = result.side === "Up" ? v.books.up : v.books.down;
        const plan = entryPlan(config, book, budget, v.m.feeRate, v.m.feeExponent);
        const depth = plan.ok;
        const risk = budget && canEnter(s, budget, Date.now());
        let reason = !s.armed
          ? "ARM is off"
          : !result.eligible
            ? result.reason
            : !depth
              ? plan.reason
              : !risk
                ? "Liquidity, position or loss limit reached"
                : !v.accepting
                  ? "Market is not accepting orders"
                  : !jobs.entriesEnabled
                    ? "Entries paused by administrator"
                    : "Entry eligible";
        if (s.seenMarkets.some((x) => x.slug === v.m.slug))
          reason = "This window was already traded";
        const marks = s.positions
          .filter((p) => p.market.slug === v.m.slug && p.shares > 0)
          .map((p) => ({
            id: p.id,
            value:
              sellQuote(
                (p.side === "Up" ? i.up : i.down).bids,
                p.shares - p.sold,
                0.001,
                p.market.feeRate,
                p.market.feeExponent,
              )?.cashMicros ?? null,
          }));
        rows.push({
          pair: v.pair,
          window: v.window,
          ...result,
          eligible: reason === "Entry eligible",
          reason,
          stake: budget,
          marks,
        });
        for (const p of [...run.state.positions].filter(
          (p) =>
            p.market.slug === v.m.slug &&
            !p.order &&
            p.shares > 0 &&
            !p.inventoryError,
        )) {
          if (
            !s.armed ||
            run.member_status !== "active" ||
            (run.mode === "live" && !geoAllowed)
          )
            continue;
          const sig = exitSignal(p, i, config);
          if (!sig) continue;
          const token = p.side === "Up" ? p.market.upToken : p.market.downToken;
          if (
            run.mode === "live" &&
            (await walletShares(run, token)) < p.shares - p.sold
          ) {
            await command(run, { action: "inventory", positionId: p.id });
            continue;
          }
          // Use a valid observed book tick without relaxing the net-profit floor.
          const pb = p.side === "Up" ? i.up : i.down;
          const exit = exitPlan(pb.bids, sig.shares, sig.min, v.m.feeRate, v.m.feeExponent);
          if (!exit) continue;
          const limit = exit.limit;
          const prepared =
            run.mode === "live"
              ? await prepareSell(run, token, sig.shares, limit)
              : null;
          await fire(
            run,
            {
              action: "exit",
              positionId: p.id,
              orderId: prepared?.orderId || randomUUID(),
              purpose: sig.purpose,
              shares: sig.shares,
              limit,
              observation: i,
            },
            prepared,
          );
        }
        if (
          reason === "Entry eligible" && plan.ok &&
          run.member_status === "active" &&
          (run.mode === "paper" || geoAllowed) &&
          !run.state.positions.some((p) => p.market.slug === v.m.slug)
        ) {
          const token = result.side === "Up" ? v.m.upToken : v.m.downToken,
            prepared =
              run.mode === "live"
                ? await prepareBuy(
                    run,
                    token,
                    budget,
                    plan.limit,
                  )
                : null;
          await fire(
            run,
            {
              action: "entry",
              positionId: randomUUID(),
              market: v.m,
              observation: i,
              orderId: prepared?.orderId || randomUUID(),
            },
            prepared,
          );
        }
      }
      const blockers = new Map();
      for (const row of rows) if (!row.eligible) blockers.set(row.reason, (blockers.get(row.reason) || 0) + 1);
      const common = [...blockers].sort((a, b) => b[1] - a[1])[0];
      await command(run, {
        action: "scan",
        rows,
        message: run.state.armed
          ? rows.some(r => r.eligible) ? "Reversal passed the entry checks." : common ? `No entry. Most common blocker (${common[1]}/${rows.length} markets): ${common[0]}` : "Waiting for market checks."
          : "ARM is off. No new buy or sell orders.",
      });
    } catch (e) {
      console.warn(
        "CheapShare run deferred:",
        run.id,
        e.status || "",
        e.message.includes("Wallet")
          ? "Wallet verification failed"
          : e.message.slice(0, 180),
      );
    }
  }
}
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    stopped = true;
    feeds.stop();
  });
feeds.start();
console.log(
  "CheapShare engine started; paper/default ARM off; isolated execution journal.",
);
while (!stopped) {
  const at = Date.now();
  try {
    await tick();
  } catch (e) {
    console.warn(
      "CheapShare tick deferred:",
      e.status || "",
      e.message.slice(0, 180),
    );
  }
  await sleep(Math.max(50, 1000 - (Date.now() - at)));
}
