"use client";
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Settings2,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DataTable, money, requestJSON } from "./workspace-components";
import { BotRiskMetrics } from "./bot-risk-metrics";
import type { BotRiskMetrics as RiskMetrics } from "@/lib/bot-performance";
import {
  DEFAULT_CONFIG,
  type Config,
} from "@/lib/bots/crypto-shares/cheapshare/config.ts";
import { PAIRS } from "@/lib/bots/crypto-shares/cheapshare/identity.ts";
import type {
  State,
  Position,
  Fill,
} from "@/lib/bots/crypto-shares/cheapshare/state.ts";
type Row = {
  pair: string;
  window: number;
  reason: string;
  eligible: boolean;
  side?: string;
  setup?: string;
  ask?: number;
  projection?: string;
  requiredSpot?: string;
  conservativeSpot?: string;
  headroom?: string;
  windowSeconds?: number;
  secondsLeft?: number;
  gates?: { name: string; ok: boolean }[];
  marks?: { id: string; value: number | null }[];
};
type Run = {
  id: string;
  mode: "paper" | "live";
  revision: number;
  walletAddress: string | null;
  hasWallet: boolean;
  state: State;
  riskMetrics: RiskMetrics | null;
  history: {
    id: string;
    kind: string;
    created_at: string;
    data: {
      closed: Position | null;
      command: { action: string; fills?: Fill[] };
    };
  }[];
};
type Market = {
  pair: string;
  window: number;
  strike: string | null;
  strikeSource: string | null;
  twap: { at: number; value: string } | null;
  spot: { at: number; bid: string; ask: string } | null;
  spotSource?: string;
  error: string | null;
  end: number | null;
};
type Response = {
  runs: Run[];
  online: boolean;
  feed: {
    heartbeat: number;
    geoAllowed: boolean;
    message: string;
    markets: Market[];
  } | null;
};
const usd = (n: number) => money(n / 10000),
  price = (v: string | null | undefined) =>
    v
      ? new Intl.NumberFormat("en-US", {
          maximumFractionDigits: Number(v) / 1e18 < 1 ? 6 : 2,
        }).format(Number(v) / 1e18)
      : "—";
export function CheapshareBot() {
  const [data, setData] = useState<Response | null>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(() => Date.now()),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<string | null | undefined>(undefined),
    [mode, setMode] = useState<"paper" | "live">("paper"),
    [config, setConfig] = useState<Config>(structuredClone(DEFAULT_CONFIG)),
    [address, setAddress] = useState(""),
    [key, setKey] = useState(""),
    [review, setReview] = useState<string | null>(null),
    [ack, setAck] = useState(false),
    [showMarkets, setShowMarkets] = useState(false);
  useEffect(() => {
    let alive = true,
      pending = false;
    async function poll() {
      if (pending) return;
      pending = true;
      try {
        const d = await requestJSON<Response>(`/api/cheapshare?page=${page}`);
        if (alive) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        pending = false;
      }
    }
    void poll();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void poll();
      }
    }, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [page]);
  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await requestJSON("/api/cheapshare", payload);
      setData(await requestJSON<Response>(`/api/cheapshare?page=${page}`));
      setEdit(undefined);
      setReview(null);
      setKey("");
      toast.success(
        payload.action === "deploy"
          ? "CheapShare deployed with ARM off."
          : "CheapShare updated.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function settings(run?: Run) {
    setEdit(run?.id || null);
    setMode(
      run?.mode ||
        (data?.runs.some((r) => r.mode === "paper") ? "live" : "paper"),
    );
    setConfig(structuredClone(run?.state.config || DEFAULT_CONFIG));
    setAddress(run?.walletAddress || "");
    setKey("");
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const r = data?.runs.find((r) => r.id === edit);
    void submit({
      action: r ? "configure" : "deploy",
      ...(r ? { runId: r.id, revision: r.revision } : { mode }),
      config,
      ...(mode === "live" && key
        ? { walletAddress: address, walletKey: key }
        : {}),
    });
  }
  function arm(run: Run) {
    if (run.mode === "live") {
      setAck(false);
      setReview(run.id);
    } else
      void submit({
        action: "arm",
        runId: run.id,
        revision: run.revision,
        confirmVersion: null,
      });
  }
  const online =
    !!data?.online && !!data.feed && now - data.feed.heartbeat < 10000;
  const reviewed = data?.runs.find((r) => r.id === review),
    editing = data?.runs.find((r) => r.id === edit);
  const number = (
    label: string,
    k: keyof Config,
    min: number,
    max: number,
    scale = 1,
    step = 1,
  ) => (
    <label className="cs-field" key={k}>
      {label}
      <Input
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={Number(config[k]) / scale}
        onChange={(e) =>
          setConfig({
            ...config,
            [k]: Math.round(Number(e.target.value) * scale),
          })
        }
      />
    </label>
  );
  return (
    <section className="panel cs-bot" aria-label="CheapShare bot">
      <div className="row-between cs-heading">
        <div>
          <span className="bot-family-label">CRYPTO SHARES · REVERSAL</span>
          <h2>
            CheapShare
            <span className="cs-rule" />
          </h2>
          <p className="muted">Catch the change that can turn the round.</p>
        </div>
        <span className="tag">6 pairs · 5m / 15m</span>
      </div>
      <div className="cs-description">
        <p>
          Watch for an established winner to face a sudden spot reversal. Enter only
          when the stressed TWAP estimate clears the strike and executable prices leave profit room.
        </p>
        <button
          className="button ghost"
          onClick={() => settings()}
          disabled={busy || data?.runs.length === 2}
        >
          Deploy bot <ArrowUpRight size={16} />
        </button>
      </div>
      {error && (
        <p role="alert" className="liquidity-warning">
          {error}
        </p>
      )}
      <div className="cs-feed">
        <span className={`cs-dot ${online ? "on" : ""}`} />
        {online ? "Engine connected" : "Waiting for engine"}
        <span className="muted">
          Paper by default · ARM off until you start
        </span>
      </div>
      {data?.feed?.message && (
        <p className="small muted">{data.feed.message}</p>
      )}
      {!data?.runs.length && (
        <BotRiskMetrics emptyLabel={data ? "No closed trades yet" : "Performance data unavailable"} />
      )}
      {data?.runs.map((run) => {
        const s = run.state,
          rows = s.scan as Row[];
        return (
          <div className="cs-run" key={run.id}>
            <div className="row-between">
              <div className="cs-controls">
                <span
                  className={`tag ${run.mode === "paper" ? "" : "cs-live"}`}
                >
                  {run.mode === "paper" ? "PAPER" : "LIVE"}
                </span>
                <strong>{s.armed ? "Armed" : "ARM off"}</strong>
              </div>
              <div className="cs-controls">
                <button
                  className="icon-button"
                  title="CheapShare settings"
                  aria-label={`${run.mode} CheapShare settings`}
                  disabled={busy}
                  onClick={() => settings(run)}
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
            <div className="cs-metrics">
              <div>
                <span>
                  {run.mode === "paper"
                    ? "Simulated cash"
                    : "Last verified wallet cash"}
                </span>
                <strong>
                  {run.mode === "paper"
                    ? usd(s.cash)
                    : s.connection.balance === null
                      ? "—"
                      : usd(s.connection.balance)}
                </strong>
              </div>
              <div>
                <span>Realized P/L</span>
                <strong className={s.pnl < 0 ? "negative" : "positive"}>
                  {usd(s.pnl)}
                </strong>
              </div>
              <div>
                <span>Wins / losses</span>
                <strong>
                  {s.wins} <small>/ {s.losses}</small>
                </strong>
              </div>
              <div>
                <span>Open positions</span>
                <strong>
                  {s.positions.length} <small>/ 2</small>
                </strong>
              </div>
            </div>
            <BotRiskMetrics
              metrics={run.riskMetrics}
              emptyLabel={s.trades > 0 ? "Performance data unavailable" : "No closed trades yet"}
            />
            <p className="small muted">
              {s.message}{" "}
              {run.mode === "paper"
                ? "Simulated fills and fees; activity stays inside this bot."
                : s.connection.message}
            </p>
            {s.positions.length > 0 && (
              <DataTable
                headers={[
                  "Window",
                  "Position",
                  "Entry average",
                  "Shares remaining",
                  "Executable value",
                  "Orders",
                ]}
                rows={s.positions.map((p) => {
                  const mark = rows
                    .flatMap((r) => r.marks || [])
                    .find((m) => m.id === p.id)?.value;
                  return [
                    <a
                      key={p.id}
                      href={`https://polymarket.com/event/${p.market.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.market.pair} · {p.market.window / 60}m
                    </a>,
                    `${p.side} · Reversal`,
                    p.shares
                      ? `${(((p.cost - p.fills.filter((f) => f.side === "BUY").reduce((n, f) => n + f.feeMicros, 0)) / p.shares) * 100).toFixed(3)}¢`
                      : "Awaiting fill",
                    ((p.shares - p.sold) / 1e6).toFixed(6),
                    mark == null || !online ? "—" : usd(mark),
                    p.inventoryError
                      ? "Inventory mismatch"
                      : p.order
                        ? `${p.order.side} · ${p.order.status}`
                        : "Watching reversal strength",
                  ];
                })}
                empty="No open positions."
              />
            )}
            <details className="cs-details">
              <summary>
                Entry checklist <ChevronDown size={15} />
              </summary>
              <div className="cs-checks">
                {PAIRS.flatMap((pair) =>
                  [300, 900].map((w) => {
                    const row = rows.find(
                      (r) => r.pair === pair && r.window === w,
                    );
                    return (
                      <details key={`${pair}:${w}`}>
                        <summary>
                          <strong>
                            {pair} <span className="muted">{w / 60}m</span>
                          </strong>
                          <span>
                            {row?.reason || "Waiting for public feeds"}
                          </span>
                        </summary>
                        {row?.side && (
                          <p className="small">
                            Buy {row.side} · Ask{" "}
                            {row.ask == null
                              ? "—"
                              : `${(row.ask * 100).toFixed(1)}¢`}{" "}
                            · Estimated settlement TWAP {price(row.projection)}
                            <br />
                            Required sustained spot {price(row.requiredSpot)} · Stressed spot {price(row.conservativeSpot)}
                            <br />
                            {row.secondsLeft?.toFixed(0) ?? "—"}s remaining · {row.windowSeconds ?? "—"}s lookback
                          </p>
                        )}
                        {row?.gates?.map((g) => (
                          <p key={g.name} className="small">
                            <span className={g.ok ? "positive" : "muted"}>
                              {g.ok ? "✓" : "○"}
                            </span>{" "}
                            {g.name}
                          </p>
                        ))}
                      </details>
                    );
                  }),
                )}
              </div>
            </details>
            <details className="cs-details">
              <summary>
                Trade history & execution records <ChevronDown size={15} />
              </summary>
              <DataTable
                headers={["Time", "Event", "Execution", "Net cash / P&L"]}
                rows={run.history.map((e) => [
                  new Date(e.created_at).toLocaleString(),
                  e.kind === "closed"
                    ? `${e.data.closed?.market.pair} · ${e.data.closed?.side}`
                    : e.kind,
                  e.data.closed?.closeReason ||
                    e.data.command.fills
                      ?.map(
                        (f) =>
                          `${f.side} ${(f.sharesMicros / 1e6).toFixed(6)} @ ${(Number(f.price) * 100).toFixed(3)}¢`,
                      )
                      .join(", ") ||
                    "Awaiting confirmation",
                  e.data.closed
                    ? usd(e.data.closed.pnl || 0)
                    : e.data.command.fills
                      ? usd(
                          e.data.command.fills.reduce(
                            (n, f) => n + f.cashMicros,
                            0,
                          ),
                        )
                      : "—",
                ])}
                empty="No trades yet."
              />
              {run.history.map((e) =>
                e.data.command.fills?.map((f) => (
                  <div className="cs-execution small muted" key={f.id}>
                    <span>
                      {f.side} order {f.orderId}
                    </span>
                    <span>
                      Fees {usd(f.feeMicros)} ·{" "}
                      {f.transactionHash ? (
                        <a
                          href={`https://polygonscan.com/tx/${f.transactionHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Confirmed transaction ↗
                        </a>
                      ) : (
                        "Paper simulation"
                      )}
                    </span>
                  </div>
                )),
              )}
            </details>
          </div>
        );
      })}
      {!!data?.runs.length && (
        <div className="row-between small cs-pages">
          <button
            className="button ghost"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous history
          </button>
          <span>Page {page}</span>
          <button
            className="button ghost"
            disabled={!data.runs.some((r) => r.history.length === 30)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next history
          </button>
        </div>
      )}
      <button
        className="cs-market-toggle"
        onClick={() => setShowMarkets(!showMarkets)}
      >
        Public market references <ChevronDown size={15} />
      </button>
      {showMarkets && (
        <>
          <DataTable
            headers={[
              "Market",
              "Price-to-Beat",
              "Chainlink TWAP",
              "Spot mid",
              "Source",
            ]}
            rows={(data?.feed?.markets || []).map((m) => [
              `${m.pair} · ${m.window / 60}m`,
              price(m.strike),
              m.twap && data?.feed && now - m.twap.at < 3000
                ? price(m.twap.value)
                : "—",
              m.spot && data?.feed && now - m.spot.at < 1500
                ? price(
                    ((BigInt(m.spot.bid) + BigInt(m.spot.ask)) / 2n).toString(),
                  )
                : "—",
              m.error || [m.spotSource, m.strikeSource || "Waiting for opening reference"].filter(Boolean).join(" · "),
            ])}
            empty="No public feed observations yet."
          />
          <p className="small muted">
            Binance USDT and Hyperliquid HYPE/USDC spot quotes are USD proxies. Chainlink supplies the official spot and TWAP observations. A missing spot pair or
            an unverified strike blocks that market.
          </p>
        </>
      )}
      <Dialog
        open={edit !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setEdit(undefined);
            setKey("");
          }
        }}
      >
        <DialogContent className="cs-settings">
          <DialogHeader>
            <DialogTitle>CheapShare settings</DialogTitle>
            <DialogDescription>
              Save to your account. Disarm and close positions before changing
              configuration.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save}>
            {!editing && (
              <label className="cs-field">
                Mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "paper" | "live")}
                >
                  <option
                    value="paper"
                    disabled={data?.runs.some((r) => r.mode === "paper")}
                  >
                    Paper
                  </option>
                  <option
                    value="live"
                    disabled={data?.runs.some((r) => r.mode === "live")}
                  >
                    Live
                  </option>
                </select>
              </label>
            )}
            <div className="cs-form-grid">
              {number(
                "Strategy bankroll ($)",
                "bankrollCents",
                100,
                1000000,
                100,
                0.01,
              )}
              {number("Allocation cap per trade ($)", "tradeBudgetCents", 1, 10000, 100, 0.01)}
              {number("Maximum bankroll per trade (%)", "riskBp", 0.01, 2, 100, 0.01)}
              {number("Net profit target (%)", "profitTargetBp", 1, 1000, 100, 1)}
              {number("Minimum profit room (%)", "minimumUpsideBp", 1, 100, 100, 1)}
              {number("Maximum entry spread + fees (%)", "maximumEntryLossBp", 1, 30, 100, 1)}
              {number("Daily loss limit (%)", "dailyLossBp", 1, 10, 100, 0.01)}
              {number(
                "Weekly loss limit (%)",
                "weeklyLossBp",
                1,
                20,
                100,
                0.01,
              )}
            </div>
            <div className="cs-switches">
              {[
                ["newsBlocked", "Block new entries for news"],
              ].map(([k, label]) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={!!config[k as keyof Config]}
                    onChange={(e) =>
                      setConfig({ ...config, [k]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="small muted">
              Allocation uses the lower of the dollar cap and bankroll percentage. Paper cash is simulated.
              There is no fixed entry-price band. Entry costs, exit liquidity and available profit room must pass.
              Loss limits include open exposure and reset on UTC days and Mondays.
            </p>
            <details className="cs-details">
              <summary>
                Pair and window thresholds <ChevronDown size={15} />
              </summary>
              {Object.entries(config.presets).map(([id, p]) => (
                <fieldset className="cs-preset" key={id}>
                  <legend>
                    {id.split(":")[0]} · {Number(id.split(":")[1]) / 60}m
                  </legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          presets: {
                            ...config.presets,
                            [id]: { ...p, enabled: e.target.checked },
                          },
                        })
                      }
                    />{" "}
                    Enabled
                  </label>
                  <div className="cs-form-grid">
                    {(
                      [
                        ["leaderSeconds", "Established winner (s)", 3, 60, 1],
                        ["impulseSeconds", "Sudden move window (s)", 3, 15, 1],
                        ["impulseMultiple", "Move / previous gap", 1.25, 10, 0.25],
                        ["holdSeconds", "Reversal confirmation (s)", 1, 10, 1],
                        ["clearBufferBp", "Settlement buffer (bp)", 0.05, 20, 0.05],
                        ["maxModelErrorBp", "Maximum TWAP model error (bp)", 0.05, 5, 0.05],
                        ["retreatPct", "Spot retracement stress (%)", 10, 75, 1],
                        ["timeBufferSeconds", "Execution reserve (s)", 2, 10, 1],
                        ["exitHeadroomPct", "Exit at remaining strength (%)", 10, 90, 1],
                      ] as const
                    ).map(([k, label, min, max, step]) => (
                      <label className="cs-field" key={k}>
                        {label}
                        <Input
                          type="number"
                          required
                          min={min}
                          max={max}
                          step={step}
                          value={p[k]}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              presets: {
                                ...config.presets,
                                [id]: { ...p, [k]: Number(e.target.value) },
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </details>
            {mode === "live" && (
              <fieldset className="cs-preset">
                <legend>Polymarket connection</legend>
                <label className="cs-field">
                  Polymarket account address
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x…"
                    autoComplete="off"
                  />
                </label>
                <label className="cs-field">
                  Wallet signing key
                  <Input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={
                      editing?.hasWallet
                        ? "Saved securely · leave blank to keep"
                        : "Enter wallet key"
                    }
                    autoComplete="new-password"
                  />
                </label>
                <p className="small muted">
                  CLOB credentials are derived automatically. Missing spending
                  approvals must be completed on Polymarket.
                </p>
              </fieldset>
            )}
            <p className="small muted">
              ARM off blocks both entries and exits. Submitted orders are still
              reconciled. Saving never starts live trading.
            </p>
            <button
              className="button"
              disabled={
                busy ||
                (!!editing &&
                  (editing.state.armed || editing.state.positions.length > 0))
              }
              type="submit"
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
        open={!!reviewed}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arm CheapShare live</DialogTitle>
            <DialogDescription>
              Review this configuration before enabling real orders.
            </DialogDescription>
          </DialogHeader>
          {reviewed && (
            <>
              <p>
                Bankroll {money(reviewed.state.config.bankrollCents)} · risk{" "}
                {reviewed.state.config.riskBp / 100}% per trade, capped at {money(reviewed.state.config.tradeBudgetCents)} · daily
                limit {reviewed.state.config.dailyLossBp / 100}% · weekly limit{" "}
                {reviewed.state.config.weeklyLossBp / 100}%.
              </p>
              <p className="small muted">
                Up to two positions. Net profit target {reviewed.state.config.profitTargetBp / 100}%.
                A weakening reversal triggers an earlier exit, which can realize a loss.
                The TWAP projection is an estimate, not a guaranteed outcome.
              </p>
              <label className="cs-ack">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                I reviewed the pair thresholds and authorize live CheapShare
                orders with this configuration.
              </label>
              {!data?.feed?.geoAllowed && (
                <p className="small">
                  Live trading is unavailable from the engine’s current region.
                </p>
              )}
              <button
                className="button"
                disabled={
                  !ack ||
                  busy ||
                  !online ||
                  !data.feed?.geoAllowed ||
                  reviewed.state.connection.status !== "connected"
                }
                onClick={() =>
                  void submit({
                    action: "arm",
                    runId: reviewed.id,
                    revision: reviewed.revision,
                    confirmVersion: reviewed.state.configVersion,
                  })
                }
              >
                Arm live bot
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
