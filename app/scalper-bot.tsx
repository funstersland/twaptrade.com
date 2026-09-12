"use client";
import { useEffect, useState } from "react";
import { Play, Pause, Settings2, Crosshair, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DataTable,
  ChoiceSelect,
  money,
  requestJSON,
} from "./workspace-components";
import { BotRiskMetrics } from "./bot-risk-metrics";
import {
  DEFAULT_CONFIG,
  type Config,
} from "@/lib/bots/crypto-shares/scalper/config";
import {
  HORIZONS,
  FRAMES,
  type Horizon,
} from "@/lib/bots/crypto-shares/scalper/identity";
import type { State, Closed } from "@/lib/bots/crypto-shares/scalper/state";
import type { Candle } from "@/lib/bots/crypto-shares/scalper/candles";
import {
  nextEntryAt,
  nextStake,
  type Signal,
  type Zone,
} from "@/lib/bots/crypto-shares/scalper/rules";
type Run = {
  id: string;
  mode: "paper" | "live";
  revision: number;
  walletAddress: string | null;
  hasWallet: boolean;
  state: State;
  history: {
    id: string;
    kind: string;
    createdAt: string;
    closed: Closed | null;
  }[];
};
type Response = {
  runs: Run[];
  online: boolean;
  feed: {
    heartbeat: number;
    candles: Candle[];
    latest: { at: number; value: string } | null;
    message: string;
    checks?: { runId: string; horizon: Horizon; target: number; at: number; reason: string }[];
  } | null;
  signals: (Signal & { horizon: Horizon })[];
};
const label = (h: number) => (h === 3600 ? "1 hour" : `${h / 60} min`);
const usd = (micros: number) => money(micros / 10000);
export function ScalperBot() {
  const [data, setData] = useState<Response | null>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(() => Date.now()),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Run | null | undefined>(undefined),
    [mode, setMode] = useState<"paper" | "live">("paper"),
    [config, setConfig] = useState<Config>(structuredClone(DEFAULT_CONFIG)),
    [address, setAddress] = useState(""),
    [key, setKey] = useState(""),
    [review, setReview] = useState<Run | null>(null),
    [ack, setAck] = useState(false);
  useEffect(() => {
    let alive = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await requestJSON<Response>(`/api/scalper?page=${page}`);
        if (alive) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void poll();
      }
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [page]);
  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await requestJSON("/api/scalper", payload);
      setData(await requestJSON<Response>(`/api/scalper?page=${page}`));
      setEditing(undefined);
      setReview(null);
      setKey("");
      toast.success(
        payload.action === "deploy"
          ? "Scalper deployed with ARM off"
          : "Scalper settings updated",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function settings(run: Run | null = null) {
    setEditing(run);
    setMode(run?.mode || "paper");
    setConfig(structuredClone(run?.state.config || DEFAULT_CONFIG));
    setAddress(run?.walletAddress || "");
    setKey("");
  }
  function arm(run: Run) {
    if (run.mode === "live") {
      setReview(run);
      setAck(false);
    } else
      void submit({
        action: "arm",
        runId: run.id,
        revision: run.revision,
        confirmVersion: run.state.configVersion,
      });
  }
  const online = !!data?.feed && now - data.feed.heartbeat < 10000;
  return (
    <section className="panel scalper-bot">
      <div className="row-between scalper-heading">
        <div className="continuation-brand">
          <span className="strategy-icon">
            <Crosshair size={24} />
          </span>
          <div>
            <span className="bot-family-label">CRYPTO SHARES · POLYMARKET</span>
            <h2>
              Scalper <span className="tag">BTC · 5m / 15m / 1h</span>
            </h2>
          </div>
        </div>
        <button
          className="button"
          disabled={busy || data?.runs.length === 2}
          onClick={() => settings()}
        >
          Deploy bot <ArrowUpRight size={16} />
        </button>
      </div>
      <p className="scalper-description">
        TWAP support and resistance. Closed-candle rejection. Enter the next
        round before T−20.
      </p>
      <div className="scalper-status">
        <span>{online ? "Engine connected" : "Waiting for engine"}</span>
        <span className="muted">Paper first · Performance unproven</span>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <Tabs defaultValue="300">
        <TabsList variant="line">
          {HORIZONS.map((h) => (
            <TabsTrigger key={h} value={String(h)}>
              {label(h)}
            </TabsTrigger>
          ))}
        </TabsList>
        {HORIZONS.map((h) => {
          const signal = data?.signals.find((s) => s.horizon === h),
            candles =
              data?.feed?.candles
                .filter((c) => c.seconds === FRAMES[h].context)
                .slice(-60) || [],
            remaining = Math.max(
              0,
              Math.ceil((nextEntryAt(now, h) - now) / 1000),
            );
          return (
            <TabsContent key={h} value={String(h)}>
              <div className="scalper-chart-top">
                <div>
                  <strong>{label(h)} upcoming round</strong>
                  <p className="small muted">
                    {h === 3600
                      ? "TWAP signal · Binance BTC/USDT hourly settlement"
                      : "Chainlink BTC/USD · 60-second TWAP settlement"}
                  </p>
                </div>
                <span className="tag">
                  Next entry check in {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </span>
              </div>
              <CandleChart candles={candles} zones={signal?.zones || []} />
              <div className="scalper-signal">
                <strong>
                  {!online
                    ? "Waiting"
                    : signal?.direction
                      ? `${signal.direction} rejection`
                      : "No trade signal"}
                </strong>
                <span>
                  {online
                    ? signal?.reason || "Warming up"
                    : data?.feed?.message ||
                      "The engine will collect complete TWAP candles before trading."}
                </span>
              </div>
              <p className="small muted">
                Levels use {FRAMES[h].context / 60}m closed candles; rejection
                uses{" "}
                {FRAMES[h].signal < 60
                  ? `${FRAMES[h].signal}s`
                  : `${FRAMES[h].signal / 60}m`}{" "}
                closed candles. An open candle never confirms a rejection.
              </p>
            </TabsContent>
          );
        })}
      </Tabs>
      {!data?.runs.length && (
        <BotRiskMetrics
          emptyLabel={
            data ? "No closed trades yet" : "Performance data unavailable"
          }
        />
      )}
      {data?.runs.map((run) => {
        const s = run.state;
        return (
          <div className="scalper-run" key={run.id}>
            <div className="row-between">
              <div className="cs-controls">
                <span className="tag">{run.mode.toUpperCase()}</span>
                <strong>{s.armed ? "Armed" : "ARM off"}</strong>
                <span className="small muted">
                  {s.config.horizons.map(label).join(" · ")}
                </span>
              </div>
              <div className="cs-controls">
                <button
                  className="icon-button"
                  aria-label={`${run.mode} Scalper settings`}
                  onClick={() => settings(run)}
                  disabled={busy}
                >
                  <Settings2 size={18} />
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    s.armed
                      ? void submit({ action: "disarm", runId: run.id })
                      : arm(run)
                  }
                >
                  {s.armed ? <Pause size={15} /> : <Play size={15} />}{" "}
                  {s.armed ? "Disarm" : "Arm bot"}
                </button>
              </div>
            </div>
            <div className="continuation-metrics">
              <div>
                <span>
                  {run.mode === "paper"
                    ? "Simulated cash"
                    : "Last verified wallet cash"}
                </span>
                <strong>
                  {run.mode === "paper"
                    ? usd(s.cashMicros)
                    : s.connection.balanceMicros === null
                      ? "—"
                      : usd(s.connection.balanceMicros)}
                </strong>
              </div>
              <div>
                <span>Closed P/L</span>
                <strong className={s.pnlMicros < 0 ? "negative" : "positive"}>
                  {usd(s.pnlMicros)}
                </strong>
              </div>
              <div>
                <span>Win rate · W / L</span>
                <strong>
                  {s.wins + s.losses
                    ? `${Math.round((100 * s.wins) / (s.wins + s.losses))}%`
                    : "—"}{" "}
                  <small>
                    {s.wins} / {s.losses}
                  </small>
                </strong>
              </div>
              <div>
                <span>Max winning streak</span>
                <strong>{s.trades ? s.maxWinningStreak : "—"}</strong>
              </div>
            </div>
            <BotRiskMetrics
              metrics={
                s.trades
                  ? {
                      maxDrawdownMicros: s.maxDrawdownMicros,
                      maxLosingStreak: s.maxLosingStreak,
                    }
                  : null
              }
            />
            <div className="scalper-lots">
              {s.config.horizons.map((h) => (
                <span key={h}>
                  {label(h)} next lot{" "}
                  <strong>
                    {nextStake(s.config, s.lossStreaks[h]) === null
                      ? "Limit reached"
                      : money(nextStake(s.config, s.lossStreaks[h])!)}
                  </strong>
                </span>
              ))}
              <span>
                Martingale{" "}
                <strong>{s.config.martingale ? "On · capped" : "Off"}</strong>
              </span>
            </div>
            <p className="small muted" role="status">
              {s.message}
            </p>
            {data?.feed?.checks?.filter(c => c.runId === run.id).map(c => (
              <p className="small muted" key={c.horizon}>
                {label(c.horizon)} · Last entry check {new Date(c.at).toLocaleTimeString()} · Target round {new Date(c.target * 1000).toLocaleTimeString()}: {c.reason}
              </p>
            ))}
            {s.positions.length > 0 && (
              <DataTable
                headers={[
                  "Upcoming / active round",
                  "Direction",
                  "All-in stake",
                  "Shares",
                  "Status",
                ]}
                rows={s.positions.map((p) => [
                  <a
                    key={p.id}
                    href={`https://polymarket.com/event/${p.market.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {label(p.market.horizon)} ·{" "}
                    {new Date(p.market.start * 1000).toLocaleTimeString()}
                  </a>,
                  p.direction,
                  money(p.stakeCents),
                  p.sharesMicros ? (p.sharesMicros / 1e6).toFixed(4) : "—",
                  p.status,
                ])}
                empty="No open positions"
              />
            )}
            <details className="cs-details">
              <summary>Round history</summary>
              <DataTable
                headers={["Time", "Timeframe", "Result", "P/L"]}
                rows={run.history.map((e) => [
                  new Date(e.createdAt).toLocaleString(),
                  e.closed ? label(e.closed.market.horizon) : "—",
                  e.closed
                    ? e.closed.pnlMicros > 0
                      ? "Won"
                      : e.closed.pnlMicros < 0
                        ? "Lost"
                        : "Break-even"
                    : e.kind,
                  e.closed ? usd(e.closed.pnlMicros) : "—",
                ])}
                empty="No trades recorded"
              />
              <div className="row-between cs-pages">
                <button
                  className="text-link"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span className="small muted">Page {page}</span>
                <button
                  className="text-link"
                  disabled={run.history.length < 30}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </details>
          </div>
        );
      })}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => {
          if (!v && !busy) {
            setEditing(undefined);
            setKey("");
          }
        }}
      >
        <DialogContent className="app-dialog scalper-settings">
          <DialogHeader>
            <DialogTitle>Scalper settings</DialogTitle>
            <DialogDescription>
              BTC support/resistance rejection. Orders target the upcoming round
              before T−20 and hold until confirmed resolution.
            </DialogDescription>
          </DialogHeader>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit({
                action: editing ? "configure" : "deploy",
                ...(editing
                  ? { runId: editing.id, revision: editing.revision }
                  : { mode }),
                config,
                ...(mode === "live" && key
                  ? { walletAddress: address, walletKey: key }
                  : {}),
              });
            }}
          >
            {!editing && (
              <label>
                Mode
                <ChoiceSelect
                  label="Scalper mode"
                  value={mode}
                  onChange={(v) => setMode(v as typeof mode)}
                  options={["paper", "live"]}
                />
              </label>
            )}
            <fieldset className="scalper-horizons">
              <legend>BTC round durations</legend>
              {HORIZONS.map((h) => (
                <label key={h}>
                  <Checkbox
                    checked={config.horizons.includes(h)}
                    onCheckedChange={(v) =>
                      setConfig((c) => ({
                        ...c,
                        horizons:
                          v === true
                            ? [...c.horizons, h].sort((a, b) => a - b)
                            : c.horizons.filter((x) => x !== h),
                      }))
                    }
                  />
                  {label(h)}
                </label>
              ))}
            </fieldset>
            <div className="cs-form-grid">
              {(
                [
                  ["Base lot · USD", "baseLotCents", 100, 1, 10000],
                  ["Risk bankroll · USD", "bankrollCents", 100, 10, 1000000],
                  ["Maximum stake · % of bankroll", "maxStakeBp", 100, 0.1, 10],
                  [
                    "Daily loss + exposure limit · %",
                    "dailyLossBp",
                    100,
                    0.5,
                    20,
                  ],
                  ["Maximum entry price · cents", "maxEntryCents", 1, 10, 65],
                  ["Maximum spread · cents", "maxSpreadCents", 1, 1, 5],
                ] as const
              ).map(([text, key, scale, min, max]) => (
                <label key={key}>
                  {text}
                  <Input
                    type="number"
                    required
                    min={min}
                    max={max}
                    step={scale === 100 ? ".01" : "1"}
                    value={config[key] / scale}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        [key]: Math.round(Number(e.target.value) * scale),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <label className="scalper-checkbox">
              <Checkbox
                checked={config.martingale}
                onCheckedChange={(v) =>
                  setConfig((c) => ({ ...c, martingale: v === true }))
                }
              />
              <span>
                Martingale — double after a loss
                <small>
                  Separate streak per timeframe. Stake and daily limits always
                  apply. Doubling does not improve the signal’s win probability.
                </small>
              </span>
            </label>
            {config.martingale && (
              <label>
                Maximum doubling steps
                <Input
                  type="number"
                  min="1"
                  max="5"
                  step="1"
                  value={config.martingaleSteps}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      martingaleSteps: Number(e.target.value),
                    }))
                  }
                />
              </label>
            )}
            {mode === "live" && (
              <>
                <label>
                  Polymarket account wallet address
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x…"
                    autoComplete="off"
                  />
                </label>
                <label>
                  {editing?.hasWallet
                    ? "Replacement signing key (leave empty to keep)"
                    : "Signing key"}
                  <Input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <p className="small muted">
                  Hourly shares settle on Binance’s finalized BTC/USDT candle.
                  The TWAP chart is a signal source. Live ARM requires a
                  separate review after saving.
                </p>
              </>
            )}
            <p className="small muted">
              Paper fills are estimates. This strategy has no established win
              rate or guaranteed streak. Existing positions must resolve before
              settings can change.
            </p>
            <button
              className="button"
              disabled={busy || !config.horizons.length}
            >
              {busy
                ? "Saving…"
                : editing
                  ? "Save settings"
                  : "Deploy with ARM off"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(v) => {
          if (!v && !busy) setReview(null);
        }}
      >
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>Arm Scalper live</DialogTitle>
            <DialogDescription>
              Live orders use real wallet funds. No winning streak is
              guaranteed.
            </DialogDescription>
          </DialogHeader>
          {review && (
            <>
              <p>
                {review.state.config.horizons.map(label).join(" · ")} · Base{" "}
                {money(review.state.config.baseLotCents)} · Martingale{" "}
                {review.state.config.martingale ? "on" : "off"}
              </p>
              <p className="small muted">
                Orders enter the next round before T−20 and hold to resolution.
                Hourly contracts settle on Binance BTC/USDT; shorter rounds use
                Chainlink TWAP. The next round’s opening reference is not yet
                known at entry.
              </p>
              <label className="scalper-checkbox">
                <Checkbox
                  checked={ack}
                  onCheckedChange={(v) => setAck(v === true)}
                />
                <span>
                  I reviewed the saved configuration, settlement sources, and
                  risk limits.
                </span>
              </label>
              <button
                className="button"
                disabled={!ack || busy}
                onClick={() =>
                  void submit({
                    action: "arm",
                    runId: review.id,
                    revision: review.revision,
                    confirmVersion: review.state.configVersion,
                  })
                }
              >
                Arm live trading
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function CandleChart({
  candles,
  zones,
}: {
  candles: Candle[];
  zones: Zone[];
}) {
  const complete = candles.filter((c) => c.complete);
  if (complete.length < 2)
    return (
      <div className="scalper-chart-empty">
        <Crosshair size={28} />
        <strong>Collecting TWAP candles</strong>
        <p>
          Levels appear after 40 complete context candles. Gaps are never filled
          with invented prices.
        </p>
      </div>
    );
  const width = 900,
    height = 260,
    left = 72,
    right = 18,
    top = 24,
    bottom = 32;
  const values = complete.flatMap((c) => [
    Number(c.high) / 1e18,
    Number(c.low) / 1e18,
  ]);
  const low = Math.min(...values),
    high = Math.max(...values),
    pad = Math.max((high - low) * 0.12, high * 0.00001),
    min = low - pad,
    max = high + pad;
  const y = (price: number) =>
      top + ((max - price) / (max - min)) * (height - top - bottom),
    step = (width - left - right) / candles.length;
  return (
    <div className="scalper-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Closed Chainlink TWAP candles with confirmed support and resistance zones"
      >
        {[0, 0.5, 1].map((n) => {
          const value = min + (max - min) * n;
          return (
            <g key={n}>
              <line
                x1={left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--border)"
              />
              <text
                x={left - 10}
                y={y(value) + 4}
                textAnchor="end"
                fill="var(--muted-foreground)"
                fontSize="12"
              >
                {value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </text>
            </g>
          );
        })}
        {zones
          .filter(
            (z) =>
              Number(z.value) / 1e18 >= min && Number(z.value) / 1e18 <= max,
          )
          .map((z, i) => {
            const value = Number(z.value) / 1e18,
              color =
                z.kind === "support" ? "var(--positive)" : "var(--negative)";
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke={color}
                  strokeDasharray="5 5"
                  opacity=".75"
                />
                <text
                  x={width - right}
                  y={y(value) - 5}
                  textAnchor="end"
                  fill={color}
                  fontSize="12"
                >
                  {z.kind === "support" ? "S" : "R"} · {z.touches} touches
                </text>
              </g>
            );
          })}
        {candles.map((c, i) => {
          if (!c.complete) return null;
          const o = Number(c.open) / 1e18,
            close = Number(c.close) / 1e18,
            x = left + step * (i + 0.5),
            color = close >= o ? "var(--positive)" : "var(--negative)";
          return (
            <g key={c.start}>
              <title>
                {new Date(c.start).toLocaleString()} · O {o.toFixed(2)} H{" "}
                {(Number(c.high) / 1e18).toFixed(2)} L{" "}
                {(Number(c.low) / 1e18).toFixed(2)} C {close.toFixed(2)}
              </title>
              <line
                x1={x}
                x2={x}
                y1={y(Number(c.high) / 1e18)}
                y2={y(Number(c.low) / 1e18)}
                stroke={color}
              />
              <rect
                x={x - step * 0.29}
                y={Math.min(y(o), y(close))}
                width={Math.max(1, step * 0.58)}
                height={Math.max(1, Math.abs(y(o) - y(close)))}
                fill={color}
              />
            </g>
          );
        })}
        {[0, Math.floor(candles.length / 2), candles.length - 1].map((i) => (
          <text
            key={i}
            x={left + step * (i + 0.5)}
            y={height - 8}
            textAnchor="middle"
            fill="var(--muted-foreground)"
            fontSize="12"
          >
            {new Date(candles[i].start).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </text>
        ))}
      </svg>
    </div>
  );
}
