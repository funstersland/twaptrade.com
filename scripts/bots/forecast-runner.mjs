import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { ForecastData } from "./forecast-data.mjs";
import {
  analyze,
  nextStart,
  entryWindow,
  nextStake,
  quoteBuyCheck,
} from "../../lib/bots/crypto-shares/forecast/rules.ts";
import { entryGate } from "../../lib/bots/crypto-shares/forecast/state.ts";
import { marketAt, orderBook } from "./forecast-market.mjs";
import {
  connectionState,
  prepareBuy,
  submitBuy,
  confirmedFill,
  geographyAllowed,
} from "./forecast-live.mjs";
try {
  process.loadEnvFile(".dev.vars");
} catch {}
const origin = process.env.TWAP_FORECAST_APP_ORIGIN || "http://localhost:5173",
  url = new URL(origin);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw Error("HTTPS is required outside localhost");
if (!process.env.TWAP_FORECAST_RUNNER_TOKEN)
  throw Error("Forecast runner token is not configured");
const lease = randomUUID(),
  endpoint = origin + "/api/forecast/runner";
let stopped = false,
  latest = null,
  candles = new ForecastData(),
  jobs = { runs: [], entriesEnabled: false },
  geoAllowed = false,
  geoAt = 0,
  clockOK = false;
const plans = new Map(),
  attempted = new Set(),
  checks = new Map();
function recordCheck(run, horizon, target, reason) {
  checks.set(`${run.id}:${horizon}`, { runId: run.id, horizon, target, at: Date.now(), reason: reason.slice(0, 300) });
}
async function bridge(payload) {
  const r = await fetch(endpoint, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.TWAP_FORECAST_RUNNER_TOKEN}`,
      "content-type": "application/json",
    },
    ...(payload ? { body: JSON.stringify({ ...payload, lease }) } : {}),
    signal: AbortSignal.timeout(4000),
  });
  const d = await r.json();
  if (!r.ok) {
    const e = Error(d.message || "Forecast service unavailable");
    e.status = r.status;
    throw e;
  }
  return d;
}
async function command(run, command, book) {
  const payload = {
    action: "command",
    runId: run.id,
    revision: run.revision,
    eventId: randomUUID(),
    command,
    ...(book ? { book } : {}),
  };
  // Retries only replay an idempotent journal event, never a provider order.
  let result;
  for (let i = 0; i < 2; i++)
    try {
      result = await bridge(payload);
      break;
    } catch (e) {
      if (i || (e.status && e.status < 500)) throw e;
    }
  if (result.state) {
    run.state = result.state;
    run.revision = result.revision;
  } else if (result.duplicate) {
    const refreshed = await bridge();
    const current = refreshed.runs.find((r) => r.id === run.id);
    if (current) Object.assign(run, current);
  }
  return { result, id: payload.eventId };
}
async function heartbeat() {
  await candles.refresh().catch(() => {});
  latest = candles.latest;
  if (Date.now() - geoAt > 30000) {
    geoAllowed = await geographyAllowed().catch(() => false);
    geoAt = Date.now();
  }
  await bridge({
    action: "heartbeat",
    latest,
    candles: candles.snapshot(),
    geoAllowed,
    checks: [...checks.values()].filter(c => jobs.runs.some(r => r.id === c.runId)).slice(-300),
    message:
      latest && Date.now() - latest.at < 3000
        ? "1m / 5m / 15m / 1h BTC analysis active"
        : "Waiting for verified BTC candles and quotes",
  });
  const sent = Date.now();
  jobs = await bridge();
  clockOK = candles.clockOK && Math.abs(jobs.now - (sent + Date.now()) / 2) < 1000;
}
async function connections() {
  for (const run of jobs.runs) {
    if (
      run.mode !== "live" ||
      !run.wallet_cipher ||
      Date.now() - run.state.connection.at < 30000
    )
      continue;
    try {
      const v = await connectionState(run);
      await command(run, {
        action: "connection",
        approved: v.approved,
        balanceMicros: v.balanceMicros,
        message: v.approved
          ? "Wallet verified"
          : "Spending approvals must be completed in Polymarket",
      });
    } catch {
      await command(run, {
        action: "connection",
        approved: false,
        balanceMicros: null,
        message: "Wallet verification unavailable",
      }).catch(() => {});
    }
  }
}
async function reconcile() {
  for (const run of jobs.runs)
    for (const p of [...run.state.positions])
      try {
        if (
          p.status === "prepared" &&
          Date.now() >= p.market.start * 1000 - 20000
        ) {
          await command(run, {
            action: "unfilled",
            positionId: p.id,
            reason: "Submission window missed; no order was sent",
          });
          continue;
        }
        if (["submitting", "uncertain"].includes(p.status)) {
          if (run.mode === "paper") {
            await command(run, {
              action: "unfilled",
              positionId: p.id,
              reason: "Paper attempt interrupted; no execution assumed",
            });
            continue;
          }
          const result = await confirmedFill(run, {
            order_id: p.orderId,
            condition_id: p.market.conditionId,
            token_id:
              p.direction === "Up" ? p.market.upToken : p.market.downToken,
            start_seconds: p.market.start,
            stake_cents: p.stakeCents,
          });
          if (result?.unfilled)
            await command(run, {
              action: "unfilled",
              positionId: p.id,
              reason: "Exchange confirmed no fill",
            });
          else if (result)
            await command(run, { action: "fill", positionId: p.id, ...result });
        } else if (p.status === "open" && Date.now() >= p.market.end * 1000) {
          const m = await marketAt(p.market.start, p.market.horizon);
          if (
            m.conditionId === p.market.conditionId &&
            m.upToken === p.market.upToken &&
            m.downToken === p.market.downToken &&
            m.winner
          )
            await command(run, {
              action: "resolve",
              positionId: p.id,
              winner: m.winner,
            });
        }
      } catch {
        /* A failed reconciliation leaves this exact position unresolved. */
      }
}
async function planEntries() {
  for (const run of jobs.runs)
    for (const horizon of [...run.state.config.horizons].sort((a, b) => b - a)) {
      const now = Date.now(),
        target = nextStart(now, horizon),
        remaining = target * 1000 - now,
        key = `${run.id}:${horizon}:${target}`;
      if (
        !run.state.armed ||
        run.member_status !== "active" ||
        !jobs.entriesEnabled ||
        !clockOK ||
        attempted.has(key)
      )
        continue;
      if (remaining > 40000 || remaining <= 25000 || plans.has(key)) continue;
      const signal = analyze(candles.snapshot(), latest, horizon, now);
      if (!signal.direction) { recordCheck(run, horizon, target, signal.reason); continue; }
      try {
        const m = await marketAt(target, horizon),
          stake = nextStake(run.state.config);
        if (!m.accepting) { recordCheck(run, horizon, target, "Upcoming market is not accepting orders"); continue; }
        if (!stake) { recordCheck(run, horizon, target, "Stake limit reached"); continue; }
        if (run.state.positions.some(p=>p.status!=="open") || run.state.positions.filter(p=>p.market.horizon===horizon).length>=2) {recordCheck(run,horizon,target,"Pending order or two open positions block this timeframe");continue;}
        if (run.state.lastAttempt[horizon] >= target) continue;
        const tokenId = signal.direction === "Up" ? m.upToken : m.downToken,
          book = await orderBook(tokenId),
          quote = quoteBuyCheck(
            book,
            stake,
            run.state.config,
            m.feeRate,
            m.feeExponent,
            Date.now(),
          );
        if (!quote.quote) { recordCheck(run, horizon, target, quote.reason); continue; }
        let prepared = null;
        if (run.mode === "live") {
          if (
            !geoAllowed ||
            !process.env.TWAP_BOT_ENCRYPTION_KEY ||
            !run.state.connection.approved
          ) { recordCheck(run, horizon, target, "Live wallet or region checks did not pass"); continue; }
          prepared = await prepareBuy(
            run,
            tokenId,
            stake,
            String(run.state.config.maxEntryCents / 100),
          );
        }
        plans.set(key, {
          m,
          stake,
          tokenId,
          direction: signal.direction,
          prepared,
          version: run.state.configVersion,
        });
        recordCheck(run, horizon, target, "Quote prepared; waiting for the T−25 to T−20 entry check");
      } catch {
        recordCheck(run, horizon, target, "Market, quote or order preparation unavailable; no order sent");
      }
    }
}
// When boundaries coincide, give the least frequent window first opportunity.
// Live receipt confirmation can block later entries; never evade that protection.
async function entries() {
  for (const run of jobs.runs)
    for (const horizon of [...run.state.config.horizons].sort((a, b) => b - a)) {
      const target = nextStart(Date.now(), horizon),
        key = `${run.id}:${horizon}:${target}`,
        plan = plans.get(key);
      if (
        !plan ||
        attempted.has(key) ||
        !entryWindow(Date.now(), target, horizon)
      )
        continue;
      attempted.add(key);
      let positionId = null,
        providerAttempted = false;
      try {
        if (
          !clockOK ||
          !jobs.entriesEnabled ||
          run.member_status !== "active" ||
          run.state.configVersion !== plan.version
        )
          continue;
        const stake = entryGate(run.state, plan.m, Date.now(), geoAllowed);
        const signal = analyze(candles.snapshot(), latest, horizon, Date.now());
        if (signal.direction !== plan.direction || stake !== plan.stake) {
          recordCheck(run, horizon, target, signal.direction !== plan.direction ? `Signal changed: ${signal.reason}` : "Stake changed before submission");
          continue;
        }
        const book = await orderBook(plan.tokenId),
          checked = quoteBuyCheck(
            book,
            stake,
            run.state.config,
            plan.m.feeRate,
            plan.m.feeExponent,
            Date.now(),
          );
        const quote = checked.quote;
        if (!quote) { recordCheck(run, horizon, target, checked.reason); continue; }
        if (!entryWindow(Date.now(), target, horizon)) { recordCheck(run, horizon, target, "Quote arrived after the entry cutoff; no order sent"); continue; }
        const reserve = await command(
          run,
          {
            action: "prepare",
            market: plan.m,
            direction: plan.direction,
            stakeCents: stake,
            orderId: plan.prepared?.orderId || null,
          },
          book,
        );
        positionId = reserve.id;
        await command(run, { action: "submit", positionId });
        recordCheck(run, horizon, target, run.mode === "paper" ? "Paper order submitted" : "Order reserved for one exchange submission");
        if (run.mode === "paper") {
          const { costMicros, sharesMicros, feeMicros } = quote;
          await command(
            run,
            {
              action: "fill",
              positionId,
              costMicros,
              sharesMicros,
              feeMicros,
              fills: [],
            },
            book,
          );
        } else {
          if (!entryWindow(Date.now(), target, horizon))
            throw Error("Submission deadline missed");
          providerAttempted = true;
          const result = await submitBuy(plan.prepared, target * 1000 - 20000);
          if (!result.ok)
            await command(run, {
              action: "unfilled",
              positionId,
              reason: "Exchange rejected the FOK order",
            });
          else if (
            result.orderId?.toLowerCase() !==
              plan.prepared.orderId.toLowerCase() ||
            result.status !== "matched"
          )
            await command(run, {
              action: "uncertain",
              positionId,
              reason: "Order outcome requires reconciliation; no retry",
            });
        }
      } catch {
        recordCheck(run, horizon, target, providerAttempted ? "Exchange outcome requires reconciliation; no retry" : "Entry gate, state or deadline changed; no exchange order sent");
        if (positionId)
          await command(run, {
            action: providerAttempted ? "uncertain" : "unfilled",
            positionId,
            reason: providerAttempted
              ? "Uncertain exchange response; entries paused"
              : "Entry window missed or state changed",
          }).catch(() => {});
      }
    }
  const cutoff = Date.now() - 7200000;
  for (const [key, p] of plans) {
    if (!attempted.has(key) && Date.now() >= p.m.start * 1000 - 20000) {
      const run = jobs.runs.find(r => key === `${r.id}:${p.m.horizon}:${p.m.start}`);
      if (run) recordCheck(run, p.m.horizon, p.m.start, "Prepared quote missed the entry window; no catch-up order sent");
      attempted.add(key);
    }
    if (p.m.start * 1000 < cutoff) {
      plans.delete(key);
      attempted.delete(key);
    }
  }
}
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  const initial = await bridge();
  candles = new ForecastData(initial.feed?.candles || []);
  for (const c of initial.feed?.checks || []) checks.set(`${c.runId}:${c.horizon}`, c);
} catch {
  /* Wait for registration/service readiness below. */
}
console.log("Forecast engine started. Only member-armed runs can trade.");
let maintenanceAt = 0;
while (!stopped) {
  const began = Date.now();
  try {
    await heartbeat();
    await entries();
    const closeToEntry = [300, 900, 3600].some(
      (h) => nextStart(Date.now(), h) * 1000 - Date.now() < 45000,
    );
    if (!closeToEntry && Date.now() - maintenanceAt > 5000) {
      await connections();
      await reconcile();
      maintenanceAt = Date.now();
    }
    await planEntries();
  } catch {
    console.error("Forecast cycle unavailable; no catch-up order will be sent");
  }
  await sleep(Math.max(50, 1000 - (Date.now() - began)));
}
