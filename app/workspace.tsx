"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheapshareBot } from "./cheapshare-bot";
import { CHEAPSHARE } from "@/lib/bots/crypto-shares/cheapshare/identity";
import { ContinuationBot } from "./continuation-bot";
import { ScalperBot } from "./scalper-bot";
import { SCALPER } from "@/lib/bots/crypto-shares/scalper/identity";
import { BotRiskMetrics } from "./bot-risk-metrics";
import { CONTINUATION } from "@/lib/bots/crypto-shares/continuation/identity";
import { defaultPreferences, validPreferences } from "@/lib/appearance";
import { botFamilies } from "@/lib/bot-families";
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  Copy,
  Download,
  Bot,
  ArrowRight,
  User,
  Palette,
  ShieldCheck,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Chart, Logo, useAppearance } from "./twap-ui";
import {
  AppFrame,
  Heading,
  Metrics,
  Empty,
  DataTable,
  Status,
  Appearance,
  Security,
  Confirm,
  ChoiceSelect,
  requestJSON,
  money,
  date,
} from "./workspace-components";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import type { Account, BotRecord, Transaction } from "@/lib/models";
export function Workspace({
  section,
  entry = false,
}: {
  section: string;
  entry?: boolean;
}) {
  const [account, setAccount] = useState<Account | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [hidden, setHidden] = useState(false),
    [welcome, setWelcome] = useState(""),
    [deploy, setDeploy] = useState<BotRecord | null>(null),
    [stop, setStop] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [family, setFamily] = useState("all"),
    [walletAction, setWalletAction] = useState("");
  const { prefs, setPrefs, setSessionAccent } = useAppearance();
  const initialized = useRef(false);
  async function load() {
    try {
      const result = await requestJSON<Account>("/api/account", {
        action: "init",
      });
      setError("");
      setAccount(result);
      setSessionAccent(result.sessionAccent);
      if (!initialized.current) {
        setPrefs({
          ...defaultPreferences,
          ...validPreferences(result.profile.preferences),
        });
        if (entry) {
          setWelcome(result.isNew ? "Welcome" : "Welcome back");
        }
        initialized.current = true;
        const url = new URL(location.href);
        url.searchParams.delete("entry");
        url.searchParams.delete("demo");
        url.searchParams.delete("ref");
        history.replaceState(null, "", url.pathname + url.search);
      }
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Fetch external account state; all React updates occur after the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [section]);
  useEffect(() => {
    if (!welcome) return;
    const reduced =
      prefs.motion === "reduced" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setWelcome(""), reduced ? 200 : 1500);
    return () => clearTimeout(timer);
  }, [welcome, prefs.motion]);
  async function save(values: Record<string, unknown>) {
    const result = await requestJSON<Account>("/api/account", {
      action: "save",
      ...values,
    });
    setAccount(result);
    return result;
  }
  const held =
    account?.holdings.reduce((sum, h) => sum + (h.value_cents || 0), 0) || 0;
  const unknownValue =
    account?.holdings.some((h) => h.value_cents === null) || false;
  const reserved =
    account?.deployments
      .filter((d) => ["requested", "queued", "running"].includes(d.status))
      .reduce((n, d) => n + d.allocation_cents, 0) || 0;
  const cash = account?.balanceCents || 0;
  const visibleBots =
    account?.bots.filter((bot) => bot.strategy_key !== CONTINUATION.key && bot.strategy_key !== CHEAPSHARE.key && bot.strategy_key !== SCALPER.key && (family === "all" || bot.family === family)) ||
    [];
  const masked = (value: number) => (hidden ? "••••••" : money(value));
  const filtered =
    account?.transactions.filter((t) =>
      `${t.asset} ${t.type} ${t.id} ${t.status}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  async function submitDeploy(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!deploy) return;
    setBusy(true);
    try {
      const amount = String(new FormData(e.currentTarget).get("allocation"));
      if (!/^\d+(\.\d{1,2})?$/.test(amount))
        throw new Error("Enter an amount with up to two decimal places.");
      const allocationCents = Math.round(Number(amount) * 100);
      if (allocationCents > cash - reserved)
        throw new Error(
          `Insufficient liquidity balance. Required: ${money(allocationCents)}. Available: ${money(cash - reserved)}.`,
        );
      await requestJSON("/api/bots", {
        action: "deploy",
        botId: deploy.id,
        allocationCents,
      });
      setDeploy(null);
      toast.success("Bot deployed. Awaiting execution connection.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function txRows(list: Transaction[]) {
    return list.map((tx) => [
      <span key="id" className="mono record-id" title={tx.id}>
        {tx.id}
      </span>,
      tx.type,
      tx.asset,
      hidden ? "••••••" : tx.quantity,
      masked(tx.amount_cents),
      <Status key="status" value={tx.status} />,
      date(tx.created_at),
    ]);
  }
  return (
    <AppFrame section={section} profile={account?.profile || null}>
      {error ? (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => void load()}>Try again</button>
        </div>
      ) : null}
      {loading && !account && (
        <div className="loading-state" role="status">
          Loading your workspace…
        </div>
      )}
      {account && (
        <>
          {account.settings.announcement && (
            <div className="info-banner">{account.settings.announcement}</div>
          )}
          {account.settings.maintenanceMode && (
            <div className="info-banner">
              Platform maintenance is in progress. Deployment changes are
              paused.
            </div>
          )}
          {section === "dashboard" && (
            <>
              <Heading
                eyebrow="YOUR PORTFOLIO, IN PERSPECTIVE"
                title={`Good to see you, ${account.profile.name.split(" ")[0]}.`}
                detail="Here’s where things stand today."
              >
                <button
                  className="button button-ghost button-small"
                  onClick={() => setHidden(!hidden)}
                  aria-pressed={hidden}
                >
                  {hidden ? <Eye size={16} /> : <EyeOff size={16} />}{" "}
                  {hidden ? "Show balances" : "Hide balances"}
                </button>
                <Link href="/app/bots" className="button button-small">
                  Deploy bot
                  <ArrowUpRight size={16} />
                </Link>
              </Heading>
              <Metrics
                items={[
                  {
                    label: "Portfolio value",
                    value: unknownValue
                      ? "Pricing unavailable"
                      : masked(cash + held),
                    detail: unknownValue
                      ? "Some assets are awaiting a valuation"
                      : "Cash and recorded asset valuations",
                  },
                  {
                    label: "Available cash",
                    value: masked(cash - reserved),
                    detail: "After pending allocations",
                  },
                  {
                    label: "Active bots",
                    value: account.deployments.filter(
                      (d) => d.status === "running",
                    ).length,
                    detail: "Executing strategies",
                  },
                  {
                    label: "Transactions",
                    value: account.transactionCount,
                    detail: "Recorded account activity",
                  },
                ]}
              />
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Portfolio history</h2>
                    <span className="small muted">USD</span>
                  </div>
                  {hidden ? (
                    <Empty title="Balances hidden" />
                  ) : (
                    <Chart snapshots={account.snapshots} />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Assets</h2>
                    <Link href="/app/wallet" className="small-link">
                      View wallet
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  {account.holdings.length ? (
                    <div className="real-asset-list">
                      {account.holdings.map((h) => (
                        <div key={h.id} className="row-between">
                          <span>
                            <strong>{h.symbol}</strong>
                            <small>{h.name}</small>
                          </span>
                          <strong>
                            {h.value_cents === null
                              ? "Unpriced"
                              : masked(h.value_cents)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="No assets yet"
                      detail="Your holdings will appear after a confirmed transfer."
                    />
                  )}
                </section>
              </div>
              <div className="dashboard-bottom">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      Your bots{" "}
                      <span className="count-pill">
                        {account.deployments.length}
                      </span>
                    </h2>
                    <Link href="/app/bots" className="small-link">
                      View all
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  <DataTable
                    headers={["Bot", "Status"]}
                    rows={account.deployments
                      .slice(0, 5)
                      .map((d) => [
                        d.name,
                        <Status key="s" value={d.status} />,
                      ])}
                    empty="No deployments yet."
                  />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Recent activity</h2>
                    <Link href="/app/transactions" className="small-link">
                      View all
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                  <DataTable
                    headers={["Type", "Amount", "Date"]}
                    rows={account.transactions
                      .slice(0, 5)
                      .map((t) => [
                        t.type,
                        masked(t.amount_cents),
                        date(t.created_at),
                      ])}
                    empty="No transactions yet."
                  />
                </section>
              </div>
            </>
          )}
          {section === "wallet" && (
            <>
              <Heading
                eyebrow="A HOME FOR YOUR ASSETS"
                title="Your wallet."
                detail="Balances are based on confirmed account records."
              >
                <button
                  className="button button-ghost button-small"
                  onClick={() => setWalletAction("Withdraw")}
                >
                  Withdraw
                  <ArrowUpRight size={16} />
                </button>
                <button
                  className="button button-small"
                  onClick={() => setWalletAction("Add funds")}
                >
                  Add funds
                  <ArrowRight size={16} />
                </button>
              </Heading>
              <Metrics
                items={[
                  { label: "Cash balance", value: money(cash) },
                  { label: "Available cash", value: money(cash - reserved) },
                  { label: "Allocated cash", value: money(reserved) },
                  { label: "Assets held", value: account.holdings.length },
                ]}
              />
              <section className="panel">
                <div className="panel-heading">
                  <h2>Your assets</h2>
                </div>
                <DataTable
                  headers={[
                    "Asset",
                    "Quantity",
                    "Value in USD",
                    "Last updated",
                  ]}
                  rows={account.holdings.map((h) => [
                    <span key="a">
                      <strong>{h.symbol}</strong>
                      <small>{h.name}</small>
                    </span>,
                    h.quantity,
                    h.value_cents === null
                      ? "Awaiting valuation"
                      : money(h.value_cents),
                    date(h.updated_at),
                  ])}
                  empty="Your wallet is empty."
                />
              </section>
            </>
          )}
          {section === "transactions" && (
            <>
              <Heading
                eyebrow="EVERY MOVE, ACCOUNTED FOR"
                title="Transactions."
                detail={`${account.transactionCount} account records. Showing the latest ${account.transactions.length}.`}
              >
                <button
                  className="button button-ghost button-small"
                  disabled={!filtered.length}
                  onClick={() => exportCSV(filtered)}
                >
                  <Download size={16} />
                  Export visible records
                </button>
              </Heading>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Activity</h2>
                  <Input
                    className="table-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search transactions"
                    aria-label="Search transactions"
                  />
                </div>
                <DataTable
                  headers={[
                    "Reference",
                    "Type",
                    "Asset",
                    "Quantity",
                    "USD value",
                    "Status",
                    "Date",
                  ]}
                  rows={txRows(filtered)}
                  empty={
                    search
                      ? "No matching transactions."
                      : "No transactions yet."
                  }
                />
              </section>
            </>
          )}
          {section === "bots" && (
            <>
              <Heading
                eyebrow="PURPOSE IN EVERY MOVE"
                title="Your bots."
                detail="Deploy a published bot when your available liquidity covers its allocation."
              />
              {account.bots.length === 0 && account.deployments.length === 0 && <section className="panel"><Empty title="The catalog is currently empty" detail="Bots will appear here when the administrator publishes them." /></section>}
              {account.bots.some((bot) => bot.strategy_key === CONTINUATION.key) && <ContinuationBot />}
              {account.bots.some((bot) => bot.strategy_key === CHEAPSHARE.key) && <CheapshareBot />}
              {account.bots.some((bot) => bot.strategy_key === SCALPER.key && bot.family === SCALPER.family && bot.name.toLowerCase() === SCALPER.name.toLowerCase()) && <ScalperBot />}
              {(account.bots.some((bot) => bot.strategy_key !== CONTINUATION.key && bot.strategy_key !== CHEAPSHARE.key && bot.strategy_key !== SCALPER.key) || account.deployments.length > 0) && <>
              <Tabs defaultValue="catalog">
                <TabsList variant="line">
                  <TabsTrigger value="catalog">
                    Available bots{" "}
                    <span className="count-pill">{account.bots.filter((bot) => bot.strategy_key !== CONTINUATION.key && bot.strategy_key !== CHEAPSHARE.key && bot.strategy_key !== SCALPER.key).length}</span>
                  </TabsTrigger>
                  <TabsTrigger value="deployments">
                    My deployments{" "}
                    <span className="count-pill">
                      {account.deployments.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="catalog">
                  <div className="bot-family-filter">
                    <ChoiceSelect
                      value={family}
                      onChange={setFamily}
                      options={["all", ...botFamilies]}
                      label="Filter by bot family"
                    />
                    <span className="small muted">
                      {visibleBots.length}{" "}
                      {visibleBots.length === 1 ? "bot" : "bots"}
                    </span>
                  </div>
                  {visibleBots.length ? (
                    <div className="real-bot-grid">
                      {visibleBots.map((b) => {
                        const insufficient =
                          cash - reserved < b.min_allocation_cents;
                        const exists = account.deployments.some(
                          (d) =>
                            d.bot_id === b.id &&
                            ["requested", "queued", "running"].includes(
                              d.status,
                            ),
                        );
                        return (
                          <section className="panel real-bot-card" key={b.id}>
                            <div className="row-between">
                              <span className="strategy-icon">
                                <Bot size={22} />
                              </span>
                              <span className="tag">{b.pair}</span>
                            </div>
                            <h2>{b.name}</h2>
                            {b.family && (
                              <span className="bot-family-label">
                                {b.family}
                              </span>
                            )}
                            <p>{b.description || "No description provided."}</p>
                            <BotRiskMetrics emptyLabel="Performance data unavailable" />
                            <div className="row-between small">
                              <span className="muted">Minimum allocation</span>
                              <strong>{money(b.min_allocation_cents)}</strong>
                            </div>
                            <button
                              className="button"
                              disabled={
                                exists ||
                                insufficient ||
                                !account.settings.deploymentsOpen ||
                                account.settings.maintenanceMode
                              }
                              onClick={() => setDeploy(b)}
                            >
                              {exists ? "Already deployed" : "Deploy bot"}
                              <ArrowUpRight size={16} />
                            </button>
                            {insufficient && !exists && (
                              <small className="liquidity-warning">
                                Insufficient liquidity balance. Available:{" "}
                                {money(cash - reserved)}.
                              </small>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <section className="panel">
                      <Empty
                        title={
                          family === "all"
                            ? "The catalog is currently empty"
                            : `No ${family} bots published`
                        }
                        detail="Bots will appear here when the administrator publishes them."
                      />
                    </section>
                  )}
                </TabsContent>
                <TabsContent value="deployments">
                  <section className="panel">
                    <DataTable
                      headers={[
                        "Bot",
                        "Family",
                        "Pair",
                        "Allocation",
                        "Status",
                        "Administrator note",
                        "Deployed",
                        "Action",
                      ]}
                      rows={account.deployments.map((d) => [
                        d.name,
                        d.family || "Not assigned",
                        d.pair,
                        money(d.allocation_cents),
                        <Status key="s" value={d.status} />,
                        d.note || "—",
                        date(d.created_at),
                        ["requested", "queued"].includes(d.status) ? (
                          <button
                            key="stop"
                            className="text-link"
                            onClick={() => setStop(d.id)}
                          >
                            Stop deployment
                          </button>
                        ) : (
                          "—"
                        ),
                      ])}
                      empty="You haven’t deployed a bot yet."
                    />
                  </section>
                </TabsContent>
              </Tabs>
              <p className="workspace-note">
                Other published bots remain queued until their trading execution is connected.
              </p>
              </>}
            </>
          )}
          {section === "analytics" && (
            <>
              <Heading
                eyebrow="THE LONG VIEW"
                title="Analytics."
                detail="A record of your portfolio and account activity."
              />
              <Metrics
                items={[
                  {
                    label: "Portfolio records",
                    value: account.snapshots.length,
                    detail: "Up to the latest 365 observations",
                  },
                  {
                    label: "Recorded transactions",
                    value: account.transactionCount,
                  },
                  { label: "Assets held", value: account.holdings.length },
                  {
                    label: "Active bots",
                    value: account.deployments.filter(
                      (d) => d.status === "running",
                    ).length,
                  },
                ]}
              />
              <section className="panel">
                <div className="panel-heading">
                  <h2>Portfolio value over time</h2>
                  <span className="muted small">
                    USD · recorded observations
                  </span>
                </div>
                <Chart
                  snapshots={account.snapshots}
                  gradientId="analytics-gradient"
                />
              </section>
              <section className="panel analytics-records">
                <div className="panel-heading">
                  <h2>Valuation history</h2>
                </div>
                <DataTable
                  headers={["Recorded at", "Portfolio value"]}
                  rows={[...account.snapshots]
                    .reverse()
                    .slice(0, 20)
                    .map((s) => [date(s.recorded_at), money(s.value_cents)])}
                  empty="No portfolio observations recorded yet."
                />
              </section>
            </>
          )}
          {section === "referrals" && (
            <>
              <Heading
                eyebrow="BETTER, TOGETHER"
                title="Your circle, connected."
                detail="Invite someone to join your workspace community."
              />
              <Metrics
                items={[
                  {
                    label: "Successful referrals",
                    value: account.referralCount,
                    detail: "Accounts registered with your code",
                  },
                  {
                    label: "Referral status",
                    value: account.settings.referralsEnabled
                      ? "Open"
                      : "Paused",
                  },
                ]}
              />
              <section className="panel referral-link-panel">
                <h2>Your invitation</h2>
                <p className="muted">{account.settings.referralTerms}</p>
                <label className="settings-form">
                  Referral code
                  <Input readOnly value={account.profile.referralCode} />
                </label>
                <div className="invite-link-row">
                  <Input
                    readOnly
                    value={
                      typeof window !== "undefined"
                        ? `${location.origin}/signup?ref=${account.profile.referralCode}`
                        : `/signup?ref=${account.profile.referralCode}`
                    }
                    aria-label="Your referral link"
                  />
                  <button
                    className="button"
                    disabled={!account.settings.referralsEnabled}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${location.origin}/signup?ref=${account.profile.referralCode}`,
                        );
                        toast.success("Invitation link copied.");
                      } catch {
                        toast.error("Select the link and copy it manually.");
                      }
                    }}
                  >
                    <Copy size={16} />
                    Copy link
                  </button>
                </div>
              </section>
              <section className="panel analytics-records">
                <div className="panel-heading">
                  <h2>Joined through your invitation</h2>
                  <span className="muted small">
                    Latest {account.referrals.length}
                  </span>
                </div>
                <DataTable
                  headers={["Joined", "Status"]}
                  rows={account.referrals.map((r) => [
                    date(r.created_at),
                    "Registered",
                  ])}
                  empty="No referrals yet."
                />
              </section>
            </>
          )}
          {section === "settings" && (
            <>
              <Heading
                eyebrow="MAKE YOURSELF AT HOME"
                title="Settings."
                detail="Your profile, preferences, and security."
              />
              <Tabs defaultValue="appearance" className="settings-tabs">
                <TabsList variant="line">
                  <TabsTrigger value="profile">
                    <User size={16} />
                    Profile
                  </TabsTrigger>
                  <TabsTrigger value="appearance">
                    <Palette size={16} />
                    Appearance
                  </TabsTrigger>
                  <TabsTrigger value="security">
                    <ShieldCheck size={16} />
                    Security
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="appearance">
                  <Appearance save={save} />
                </TabsContent>
                <TabsContent value="profile">
                  <section className="setting-section">
                    <div className="setting-label">
                      <h3>Your profile</h3>
                      <p>Member since {date(account.profile.createdAt)}</p>
                    </div>
                    <form
                      className="settings-form"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        setBusy(true);
                        try {
                          await save({ name: f.get("name") });
                          toast.success("Profile updated.");
                        } catch (err) {
                          toast.error((err as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label>
                        Full name
                        <Input
                          name="name"
                          defaultValue={account.profile.name}
                          autoComplete="name"
                          required
                          maxLength={80}
                        />
                      </label>
                      <label>
                        Email address
                        <Input readOnly value={account.profile.email} />
                        <small>
                          Contact the administrator to change your email
                          address.
                        </small>
                      </label>
                      <button className="button" disabled={busy}>
                        Save changes
                        <Check size={16} />
                      </button>
                    </form>
                  </section>
                </TabsContent>
                <TabsContent value="security">
                  <Security profile={account.profile} />
                </TabsContent>
              </Tabs>
            </>
          )}
          <Dialog
            open={!!deploy}
            onOpenChange={(v) => {
              if (!v && !busy) setDeploy(null);
            }}
          >
            <DialogContent className="app-dialog">
              <DialogHeader>
                <DialogTitle>Deploy {deploy?.name}</DialogTitle>
                <DialogDescription>
                  {deploy?.family && (
                    <span className="bot-family-label">
                      {deploy.family} · {deploy.pair}
                    </span>
                  )}
                  Your available liquidity must cover the allocation. A
                  successful deployment is queued until trading execution is
                  connected.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={submitDeploy} className="settings-form">
                <label>
                  Allocation in USD
                  <Input
                    name="allocation"
                    type="number"
                    step="0.01"
                    min={(deploy?.min_allocation_cents || 0) / 100}
                    defaultValue={(deploy?.min_allocation_cents || 0) / 100}
                    required
                  />
                  <small>
                    Available liquidity: {money(cash - reserved)}. Minimum:{" "}
                    {money(deploy?.min_allocation_cents || 0)}.
                  </small>
                </label>
                <button className="button" disabled={busy}>
                  {busy ? "Deploying…" : "Deploy bot"}
                  <ArrowUpRight size={16} />
                </button>
              </form>
            </DialogContent>
          </Dialog>
          <Confirm
            open={!!stop}
            onClose={() => setStop("")}
            busy={busy}
            title="Stop this deployment?"
            detail="This removes the pending allocation. No trade will be placed."
            onConfirm={async () => {
              setBusy(true);
              try {
                await requestJSON("/api/bots", { action: "stop", id: stop });
                setStop("");
                toast.success("Deployment stopped.");
                await load();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          <Dialog
            open={!!walletAction}
            onOpenChange={(v) => {
              if (!v) setWalletAction("");
            }}
          >
            <DialogContent className="app-dialog">
              <DialogHeader>
                <DialogTitle>{walletAction}</DialogTitle>
                <DialogDescription>
                  Funding and withdrawals are not available yet.
                </DialogDescription>
              </DialogHeader>
              {account.settings.supportEmail && (
                <a
                  className="text-link"
                  href={`mailto:${account.settings.supportEmail}`}
                >
                  Contact support
                  <ArrowUpRight size={16} />
                </a>
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
      {welcome && (
        <div className="welcome-overlay" role="status">
          <Logo />
          <div className="welcome-content">
            <div className="welcome-growth" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <h2>
              {welcome}, {account?.profile.name.split(" ")[0]}.
            </h2>
            <p>Your workspace awaits.</p>
          </div>
        </div>
      )}
    </AppFrame>
  );
}
function exportCSV(rows: Transaction[]) {
  const values = [
    [
      "Reference",
      "Type",
      "Asset",
      "Quantity",
      "Amount USD",
      "Status",
      "Recorded at",
    ],
    ...rows.map((t) => [
      t.id,
      t.type,
      t.asset,
      t.quantity,
      (t.amount_cents / 100).toFixed(2),
      t.status,
      t.created_at,
    ]),
  ];
  const csv = values
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            (/^[=+\-@\t\r]/.test(v) ? "'" : "") +
            v.replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "twaptrade-transactions.csv";
  a.click();
  URL.revokeObjectURL(url);
}
