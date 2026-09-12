"use client";
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Settings2,
  ArrowUpRight,
  ChevronDown,
  Radio,
  FlaskConical,
  Check,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, Status, money, requestJSON } from "./workspace-components";
import { BotRiskMetrics } from "./bot-risk-metrics";
import { CONTINUATION } from "@/lib/bots/crypto-shares/continuation/identity";
import type {
  BotState,
  Run,
  Round,
} from "@/lib/bots/crypto-shares/continuation/types";
const dollars = (micros: number) => money(micros / 10000);
const price = (e18: string | null | undefined) =>
  e18
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(e18) / 1e18)
    : "—";
const time = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
export function ContinuationBot() {
  const [state, setState] = useState<BotState | null>(null),
    [error, setError] = useState(""),
    [settings, setSettings] = useState(false),
    [editing, setEditing] = useState<Run | null>(null),
    [paper, setPaper] = useState(false),
    [lot, setLot] = useState("10"),
    [address, setAddress] = useState(""),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<Record<string, unknown> | null>(null),
    [expanded, setExpanded] = useState<string | null>(null),
    [page, setPage] = useState(1),
    [now, setNow] = useState(() => Date.now());
  async function load() {
    const data = await requestJSON<BotState>(`/api/continuation?page=${page}`);
    setState(data);
    setError("");
  }
  useEffect(() => {
    let live = true, polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const data = await requestJSON<BotState>(
          `/api/continuation?page=${page}`,
        );
        if (live) {
          setState(data);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally { polling = false; }
    }
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [page]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  function openSettings(run: Run | null) {
    setEditing(run);
    setPaper(run?.mode === "paper");
    setLot(String((run?.base_lot_cents || 1000) / 100));
    setAddress(run?.wallet_address || "");
    setKey("");
    setSettings(true);
  }
  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await requestJSON("/api/continuation", payload);
      setSettings(false);
      setReview(null);
      setKey("");
      toast.success(
        payload.action === "deploy"
          ? "Bot deployed. Press play when ready."
          : "Bot settings saved.",
      );
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(lot) || Number(lot) < 1) {
      toast.error("Enter a lot of at least $1, with up to two decimal places.");
      return;
    }
    const payload = {
      action: editing ? "configure" : "deploy",
      ...(editing ? { runId: editing.id } : { mode: paper ? "paper" : "live" }),
      lotCents: Math.round(Number(lot) * 100),
      ...(!paper && key ? { walletAddress: address, walletKey: key } : {}),
    };
    if (!editing && !paper && (state?.balanceCents || 0) < 100000) {
      setReview(payload);
      return;
    }
    await submit(payload);
  }
  async function toggle(run: Run) {
    setBusy(true);
    try {
      await requestJSON("/api/continuation", {
        action: run.status === "running" ? "pause" : "play",
        runId: run.id,
      });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const feed = state?.feed,
    fresh = !!feed?.observed_at && now - feed.observed_at < 5000;
  const currentStart = Math.floor(now / 300000) * 300,
    end = currentStart + 300,
    remaining = Math.max(0, end - Math.floor(now / 1000));
  const signal =
    fresh &&
    feed?.round_start === currentStart &&
    feed.open_e18 &&
    feed.price_e18
      ? BigInt(feed.price_e18) > BigInt(feed.open_e18)
        ? "Up"
        : BigInt(feed.price_e18) < BigInt(feed.open_e18)
          ? "Down"
          : "Flat"
      : "Waiting";
  const cards = state?.runs.length ? state.runs : [null];
  return (
    <div className="continuation-shell">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {cards.map((run) => {
        const openRounds = run?.activeRounds || (run?.activeRound ? [run.activeRound] : []);
        return (
          <section
            className="panel continuation-card"
            key={run?.id || "catalog"}
          >
            <div className="continuation-top">
              <div className="continuation-brand">
                <span className="strategy-icon">
                  <Radio size={23} />
                </span>
                <div>
                  <span className="bot-family-label">
                    CRYPTO SHARES · POLYMARKET
                  </span>
                  <h2>
                    Continuation Strategy<span className="tag">BTC5m</span>
                  </h2>
                </div>
              </div>
              <div className="continuation-actions">
                {run?.mode === "paper" && (
                  <span className="paper-badge">
                    <FlaskConical size={14} />
                    Paper
                  </span>
                )}
                {run && (
                  <span
                    className={`bot-run-status ${run.status === "running" && state?.runnerOnline ? "is-running" : ""}`}
                  >
                    {run.status === "running"
                      ? state?.runnerOnline
                        ? "Running"
                        : "Engine offline"
                      : "Paused"}
                  </span>
                )}
                <button
                  className="icon-button"
                  aria-label="Continuation Strategy settings"
                  onClick={() => openSettings(run)}
                >
                  <Settings2 size={19} />
                </button>
                {run && (
                  <button
                    className="bot-play"
                    disabled={busy}
                    aria-label={
                      run.status === "running" ? "Pause bot" : "Start bot"
                    }
                    onClick={() => void toggle(run)}
                  >
                    {run.status === "running" ? (
                      <Pause size={20} />
                    ) : (
                      <Play size={20} />
                    )}
                  </button>
                )}
              </div>
            </div>
            <div className="continuation-metrics">
              {[
                [run?.mode === "live" ? "Closed P / L" : "Paper P / L", dollars(run?.pnlMicros || 0)],
                [
                  "Win rate",
                  run && run.wins + run.losses
                    ? `${Math.round((run.wins / (run.wins + run.losses)) * 100)}%`
                    : "—",
                ],
                ["Wins / losses", `${run?.wins || 0} / ${run?.losses || 0}`],
                [
                  "Next lot",
                  run?.nextLotCents === null
                    ? "Balance limit"
                    : money(run?.nextLotCents || 1000),
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <BotRiskMetrics
              metrics={run?.riskMetrics}
              emptyLabel={!state || (run && run.wins + run.losses > 0) ? "Performance data unavailable" : "No closed trades yet"}
            />
            {run?.accounting && (
              <details className="cs-details">
                <summary>P&amp;L breakdown</summary>
                <p className="small">
                  Profitable trades {dollars(run.accounting.profitMicros)} − losing trades {dollars(run.accounting.lossMicros)} = {dollars(run.accounting.netMicros)}.
                </p>
                <p className="small muted">
                  Average profit {run.accounting.profitableTrades ? dollars(run.accounting.profitMicros / run.accounting.profitableTrades) : "—"} · Average loss {run.accounting.losingTrades ? dollars(run.accounting.lossMicros / run.accounting.losingTrades) : "—"} · Largest loss {dollars(run.accounting.largestLossMicros)}.
                  {" "}Closed-trade fees of {dollars(run.accounting.feeMicros)} are already included. Wins and losses count trades; their dollar sizes differ. Doubling does not guarantee recovery.
                </p>
              </details>
            )}
            <div className="continuation-round">
              <div className="round-clock">
                <span className="eyebrow">CURRENT ROUND</span>
                <strong>
                  {time(currentStart)} — {time(end)}
                </strong>
                <span>
                  {String(Math.floor(remaining / 60)).padStart(2, "0")}:
                  {String(remaining % 60).padStart(2, "0")} remaining
                </span>
              </div>
              <div>
                <span className="muted small">Candle signal</span>
                <strong className={`candle-direction ${signal.toLowerCase()}`}>
                  {signal}
                </strong>
                <span className="small muted">
                  {fresh
                    ? "Chainlink · 60s TWAP"
                    : "Waiting for fresh price data"}
                </span>
              </div>
              <div className="round-prices">
                <span>
                  Round open
                  <strong>
                    {feed?.round_start === currentStart
                      ? price(feed.open_e18)
                      : "—"}
                  </strong>
                </span>
                <span>
                  Latest<strong>{fresh ? price(feed?.price_e18) : "—"}</strong>
                </span>
              </div>
            </div>
            {openRounds.map(round => <Position key={round.id} round={round} now={now} />)}
              <div className="continuation-position-empty">
                <span className="small muted">{openRounds.length ? `${openRounds.length} open rounds tracked` : "No open position"}</span>
                <span className="small">
                  Next eligible entry at{" "}
                  {new Date((end - CONTINUATION.leadSeconds) * 1000).toLocaleTimeString()} · upcoming
                  round only
                </span>
              </div>
            <div className="continuation-bottom">
              <span className="small muted">
                {run?.mode === "paper"
                  ? `Paper cash ${dollars(run.paper_cash_micros)} · Simulation stays in this bot`
                  : run?.wallet_address
                    ? `${run.connection_status === "connected" ? "Connected" : "Wallet " + run.connection_status} · ${run.wallet_address.slice(0, 6)}…${run.wallet_address.slice(-4)}${run.wallet_balance_micros !== null ? " · " + dollars(run.wallet_balance_micros) : ""}`
                    : "$1,000 recommended balance · Connect your Polymarket wallet in settings"}
              </span>
              {run ? (
                <button
                  className="text-link"
                  onClick={() => {
                    setExpanded(expanded === run.id ? null : run.id);
                    setPage(1);
                  }}
                >
                  Round history
                  <ChevronDown size={15} />
                </button>
              ) : (
                <button
                  className="button button-small"
                  onClick={() => openSettings(null)}
                >
                  Deploy bot
                  <ArrowUpRight size={16} />
                </button>
              )}
            </div>
            {run?.message && (
              <p className="bot-message" role="status">
                {run.message}
              </p>
            )}
            {run && expanded === run.id && (
              <div className="continuation-history">
                <DataTable
                  headers={[
                    "Round",
                    "Position",
                    "Lot",
                    "Shares",
                    "Entry price",
                    "Exit price",
                    "Fees",
                    "Result",
                    "P / L",
                  ]}
                  rows={run.rounds.map((r) => [
                    <a
                      key="market"
                      className="text-link"
                      href={`https://polymarket.com/event/${r.market_slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {new Date(r.start_seconds * 1000).toLocaleDateString()} ·{" "}
                      {time(r.start_seconds)}
                    </a>,
                    r.direction || "—",
                    money(r.stake_cents),
                    r.shares_micros ? (r.shares_micros / 1e6).toFixed(4) : "—",
                    r.shares_micros ? ((r.cost_micros-r.fee_micros)/r.shares_micros*100).toFixed(3)+"¢" : "—",
                    r.sold_shares_micros ? ((r.sale_proceeds_micros+r.sale_fee_micros)/r.sold_shares_micros*100).toFixed(3)+"¢" : "—",
                    r.shares_micros ? dollars(r.fee_micros+r.sale_fee_micros) : "—",
                    <span key="status">
                      <Status value={r.status} />
                      {r.reason && <small>{r.reason}</small>}
                    </span>,
                    r.pnl_micros === null ? "—" : dollars(r.pnl_micros),
                  ])}
                  empty="No rounds recorded yet."
                />
                {run.mode === "live" && run.fills?.length > 0 && <details className="execution-details">
                  <summary>Confirmed executions</summary>
                  <DataTable headers={["Order", "Side", "Price", "Shares", "Fee", "Total", "Transaction"]}
                    rows={run.fills.map(f => [
                      <span key="order" title={f.order_id}>{f.order_id.slice(0,10)}…{f.order_id.slice(-6)}</span>, f.side === "SELL" ? "Sell · wallet" : "Buy · bot",
                      (Number(f.price)*100).toFixed(3)+"¢", (f.shares_micros/1e6).toFixed(6), dollars(f.fee_micros), dollars(f.cash_micros),
                      <a key="tx" href={`https://polygonscan.com/tx/${f.transaction_hash}`} target="_blank" rel="noreferrer" className="text-link">View fill ↗</a>,
                    ])} empty="No confirmed executions." />
                </details>}
                <div className="pagination">
                  <span>{run.roundCount} rounds</span>
                  <div>
                    <button
                      className="text-link"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <button
                      className="text-link"
                      disabled={page * 20 >= run.roundCount}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        );
      })}
      {state?.runs.length === 1 && (
        <button
          className="text-link add-bot-mode"
          onClick={() => {
            openSettings(null);
            setPaper(state.runs[0].mode !== "paper");
          }}
        >
          {state.runs[0].mode === "paper"
            ? "Deploy live bot"
            : "Deploy a paper bot"}
          <ArrowUpRight size={15} />
        </button>
      )}
      <Dialog
        open={settings}
        onOpenChange={(v) => {
          if (!busy) {
            setSettings(v);
            if (!v) setKey("");
          }
        }}
      >
        <DialogContent className="app-dialog continuation-settings">
          <DialogHeader>
            <DialogTitle>Continuation Strategy · BTC5m</DialogTitle>
            <DialogDescription>
              Follow the running candle at T−20 and buy the next round.
              Open positions do not delay entry. Size doubles after confirmed
              losses and resets after a confirmed win.
            </DialogDescription>
          </DialogHeader>
          <form className="settings-form" onSubmit={save}>
            <label>
              Lot size · USD per round
              <Input
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                type="number"
                min="1"
                max="100000"
                step="0.01"
                required
              />
            </label>
            {!editing && (
              <label className="paper-toggle">
                <Checkbox
                  checked={paper}
                  onCheckedChange={(v) => setPaper(v === true)}
                />
                <span>
                  Deploy paper bot
                  <small>
                    Start with $1,000 simulated cash. Uses real market prices
                    and outcomes; fills are estimates.
                  </small>
                </span>
              </label>
            )}
            {!paper && <p className="field-hint">At 99¢ for five seconds, the exit sells all shares of the same outcome in this wallet, including other bots’ shares. P/L tracks this bot’s portion.</p>}
            {!paper && (
              <>
                <div className="wallet-settings-label">
                  <Wallet size={17} />
                  <strong>Polymarket connection</strong>
                </div>
                <label>
                  Polymarket account address
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Wallet signing key
                  <Input
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={
                      editing?.wallet_address
                        ? "Leave blank to keep the saved key"
                        : "Enter your wallet key"
                    }
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <small>
                    Encrypted when saved. Trading credentials and wallet type
                    are handled automatically.
                  </small>
                </label>
              </>
            )}
            <p className="bot-setting-note">
              Doubling can use the balance quickly. The bot pauses when it
              cannot cover the next lot. Pausing blocks new entries while
              existing positions remain tracked.
            </p>
            <button
              className="button"
              disabled={busy || editing?.status === "running"}
            >
              {busy
                ? "Saving…"
                : editing
                  ? "Save settings"
                  : paper
                    ? "Deploy paper bot"
                    : "Deploy live bot"}
              <Check size={16} />
            </button>
            {editing?.status === "running" && (
              <small>Pause the bot to edit its settings.</small>
            )}
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!review}
        onOpenChange={(v) => {
          if (!v && !busy) setReview(null);
        }}
      >
        <AlertDialogContent className="app-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Below the recommended balance</AlertDialogTitle>
            <AlertDialogDescription>
              Your available account balance is{" "}
              {money(state?.balanceCents || 0)}. This bot recommends $1,000.
              Paper mode lets you follow the same strategy with simulated funds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="balance-review-actions">
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction asChild>
              <button
                className="button button-ghost"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  if (review) void submit({ ...review, force: true });
                }}
              >
                Force proceed
              </button>
            </AlertDialogAction>
            <AlertDialogAction asChild>
              <button
                className="button"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  const existingPaper = state?.runs.find(r => r.mode === "paper");
                  if (existingPaper) { setReview(null); setSettings(false); setExpanded(existingPaper.id); return; }
                  if (review)
                    void submit({
                      action: "deploy",
                      mode: "paper",
                      lotCents: review.lotCents,
                    });
                }}
              >
                Accept recommendation
              </button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function Position({ round, now }: { round: Round; now: number }) {
  const marked = now - Date.parse(round.updated_at) < 20000 ? round.mark_micros : null;
  return (
    <div className="continuation-position">
      <span className="position-direction">
        {round.direction}
        <small>
          {time(round.start_seconds)} — {time(round.start_seconds + 300)}
        </small>
      </span>
      <div>
        <span>Position</span>
        <strong>
          {round.shares_micros
            ? ((round.shares_micros-round.sold_shares_micros) / 1e6).toFixed(4) + " shares"
            : round.status}
        </strong>
      </div>
      <div>
        <span>Cost</span>
        <strong>{dollars(round.cost_micros)}</strong>
      </div>
      <div><span>Entry price</span><strong>{round.shares_micros ? ((round.cost_micros-round.fee_micros)/round.shares_micros*100).toFixed(3)+"¢" : "—"}</strong></div>
      <div><span>99¢ exit</span><strong>{round.exit_stable_since && now-Date.parse(round.updated_at)<2000 ? `${Math.min(5,Math.floor((now-round.exit_stable_since)/1000))} / 5 sec` : "Watching bid"}</strong></div>
      <div>
        <span>Current value</span>
        <strong>
          {marked === null ? "—" : dollars(marked)}
        </strong>
      </div>
      <div>
        <span>Position P / L</span>
        <strong>
          {marked === null
            ? "—"
            : dollars(marked + round.sale_proceeds_micros - round.cost_micros)}
        </strong>
      </div>
    </div>
  );
}
