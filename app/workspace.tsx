"use client";
import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowDownLeft,
  ArrowRight,
  ArrowLeft,
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  Bot,
  ChartNoAxesCombined,
  Settings,
  Gift,
  ChevronDown,
  ChevronRight,
  Plus,
  Download,
  Search,
  ShieldCheck,
  LockKeyhole,
  LogOut,
  Eye,
  EyeOff,
  Copy,
  Check,
  Moon,
  Sun,
  Monitor,
  Sparkles,
  Activity,
  Clock,
  SlidersHorizontal,
  ExternalLink,
  User,
  AlertCircle,
  Layers,
  Palette,
  TrendingUp,
  CheckCheck,
} from "lucide-react";
import { Logo, Chart, useAppearance } from "./twap-ui";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster, toast } from "sonner";

const assets = [
  {
    name: "Bitcoin",
    symbol: "BTC",
    icon: "₿",
    class: "bitcoin",
    amount: "0.4200",
    value: 25654.44,
    change: "+2.48%",
    allocation: 53,
  },
  {
    name: "Ethereum",
    symbol: "ETH",
    icon: "Ξ",
    class: "ethereum",
    amount: "4.2500",
    value: 12823.22,
    change: "+1.86%",
    allocation: 26,
  },
  {
    name: "Solana",
    symbol: "SOL",
    icon: "◎",
    class: "solana",
    amount: "42.8000",
    value: 6318.08,
    change: "−0.74%",
    allocation: 13,
  },
  {
    name: "Tether",
    symbol: "USDT",
    icon: "₮",
    class: "tether",
    amount: "3,767.1000",
    value: 3767.1,
    change: "0.00%",
    allocation: 8,
  },
];
const transactions = [
  {
    id: "TX-9082",
    type: "Buy",
    asset: "Bitcoin",
    symbol: "BTC",
    amount: "0.0125 BTC",
    value: 763.53,
    date: "2026-09-10T14:32:00Z",
    status: "Completed",
    source: "BTC strategy",
  },
  {
    id: "TX-9081",
    type: "Sell",
    asset: "Ethereum",
    symbol: "ETH",
    amount: "0.2500 ETH",
    value: 754.3,
    date: "2026-09-10T12:18:00Z",
    status: "Completed",
    source: "ETH strategy",
  },
  {
    id: "TX-9080",
    type: "Deposit",
    asset: "Tether",
    symbol: "USDT",
    amount: "1,000.00 USDT",
    value: 1000,
    date: "2026-09-09T18:45:00Z",
    status: "Completed",
    source: "Wallet transfer",
  },
  {
    id: "TX-9079",
    type: "Buy",
    asset: "Solana",
    symbol: "SOL",
    amount: "2.4000 SOL",
    value: 354.29,
    date: "2026-09-09T09:06:00Z",
    status: "Completed",
    source: "SOL strategy",
  },
  {
    id: "TX-9078",
    type: "Buy",
    asset: "Bitcoin",
    symbol: "BTC",
    amount: "0.0080 BTC",
    value: 488.66,
    date: "2026-09-08T16:22:00Z",
    status: "Completed",
    source: "BTC strategy",
  },
  {
    id: "TX-9077",
    type: "Withdrawal",
    asset: "Tether",
    symbol: "USDT",
    amount: "250.00 USDT",
    value: 250,
    date: "2026-09-08T08:54:00Z",
    status: "Pending",
    source: "Wallet transfer",
  },
];
const nav = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "bots", label: "Bots", icon: Bot },
  { id: "analytics", label: "Analytics", icon: ChartNoAxesCombined },
];
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });
type Account = {
  profile: {
    name: string;
    email: string;
    referralCode: string;
    createdAt: string;
    lastLoginAt: string;
    preferences: Record<string, string>;
  };
  referrals: { created_at: string }[];
  referralCount: number;
  isNew: boolean;
  referralNotice?: string;
};
type Props = {
  section: string;
  demo: boolean;
  user: { name: string; email: string } | null;
  entry: boolean;
  referral: string;
};
function href(section: string, demo: boolean) {
  return `/app/${section}${demo ? "?demo=1" : ""}`;
}
async function accountRequest(data: unknown): Promise<Account> {
  const res = await fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = (await res.json()) as Account & { error?: string };
  if (!res.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
export function Workspace(props: Props) {
  const { section, demo, user, entry, referral } = props;
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!demo);
  const [welcome, setWelcome] = useState<string | null>(null);
  const [modal, setModal] = useState("");
  const [hidden, setHidden] = useState(false);
  const { setPrefs, rotateAccent, prefs } = useAppearance();
  const initialized = useRef(false);
  const name = account?.profile.name || user?.name || "Alex";
  const displayName = name.split(" ")[0];
  async function loadAccount() {
    setError("");
    setLoading(true);
    try {
      const result = await accountRequest({
        action: "initialize",
        referral,
        login: entry,
      });
      setAccount(result);
      if (
        Object.keys(result.profile.preferences).length &&
        (entry || sessionStorage.getItem("twap-pref-account") !== user?.email)
      )
        setPrefs(result.profile.preferences);
      sessionStorage.setItem("twap-pref-account", user?.email || "");
      if (result.referralNotice) toast(result.referralNotice);
      if (entry) {
        rotateAccent();
        setWelcome(result.isNew ? "Welcome" : "Welcome back");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (demo) {
      if (entry) {
        const seen = localStorage.getItem("twap-demo-welcome");
        setWelcome(seen ? "Welcome back" : "Welcome");
        localStorage.setItem("twap-demo-welcome", "1");
        rotateAccent();
      }
    } else void loadAccount();
    if (entry) {
      const url = new URL(window.location.href);
      url.searchParams.delete("entry");
      url.searchParams.delete("ref");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);
  useEffect(() => {
    if (!welcome) return;
    const reduced =
      prefs.motion === "reduced" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setWelcome(null), reduced ? 250 : 1700);
    return () => clearTimeout(timer);
  }, [welcome, prefs.motion]);
  async function saveAccount(values: Record<string, unknown>) {
    const data = await accountRequest({ action: "save", ...values });
    setAccount(data);
    return data;
  }
  return (
    <>
      <SidebarProvider
        style={{ "--sidebar-width": "235px" } as React.CSSProperties}
        className={`trading-app ${welcome ? "entering" : ""}`}
      >
        <AppSidebar section={section} demo={demo} name={name} />
        <SidebarInset className="workspace">
          <header className="workspace-header">
            <div className="workspace-breadcrumb">
              <SidebarTrigger />
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </strong>
            </div>
            <div className="workspace-header-right">
              <span className="preview-pill">
                <span /> {demo ? "Demo workspace" : "Personal workspace"}
              </span>
              <button
                className="icon-button"
                aria-label="Appearance settings"
                onClick={() => window.location.assign(href("settings", demo))}
              >
                <SlidersHorizontal size={16} />
              </button>
              <Link
                href={href("settings", demo)}
                className="avatar"
                aria-label="Account settings"
              >
                {name.slice(0, 2).toUpperCase()}
              </Link>
            </div>
          </header>
          <div className="workspace-body">
            {demo && (
              <div className="demo-banner">
                <span>
                  <Eye size={14} /> You’re exploring with sample data. No real
                  funds or trades.
                </span>
                <Link href="/signup">
                  Create your workspace <ArrowUpRight size={14} />
                </Link>
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <AlertCircle size={17} />
                <span>{error}</span>
                <button onClick={loadAccount}>Try again</button>
              </div>
            )}
            {section === "dashboard" && (
              <>
                <PageHeading
                  eyebrow="YOUR PORTFOLIO, IN PERSPECTIVE"
                  title={`Good to see you, ${displayName}.`}
                  description="Here’s where things stand today."
                >
                  <button
                    className="button button-ghost button-small"
                    onClick={() => setHidden(!hidden)}
                  >
                    {hidden ? <Eye size={16} /> : <EyeOff size={16} />}{" "}
                    {hidden ? "Show balances" : "Hide balances"}
                  </button>
                  <Link
                    href={href("wallet", demo)}
                    className="button button-small"
                  >
                    <Plus size={17} /> Manage funds
                  </Link>
                </PageHeading>
                <Metrics demo={demo} hidden={hidden} />
                <div className="dashboard-grid">
                  <PortfolioPanel demo={demo} hidden={hidden} />
                  <Allocation demo={demo} hidden={hidden} />
                </div>
                <div className="dashboard-bottom">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>
                        Strategy overview{" "}
                        <span className="count-pill">{demo ? "3" : "0"}</span>
                      </h2>
                      <Link href={href("bots", demo)} className="small-link">
                        View bots <ArrowUpRight size={14} />
                      </Link>
                    </div>
                    {demo ? (
                      <div className="strategy-rows">
                        {["BTC", "ETH", "SOL"].map((symbol, i) => (
                          <Link
                            key={symbol}
                            href={href("bots", demo)}
                            className="strategy-row"
                          >
                            <span className="strategy-icon">
                              <Bot size={18} />
                            </span>
                            <span>
                              <strong>{symbol} strategy</strong>
                              <small>{symbol} / USDT</small>
                            </span>
                            <span className="strategy-return positive">
                              {["+12.48%", "+8.32%", "+6.71%"][i]}
                            </span>
                            <span className="status neutral">Preview</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={Bot}
                        title="Your first strategy starts here"
                        detail="Your bots will appear here when trading is connected."
                      />
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Recent activity</h2>
                      <Link
                        href={href("transactions", demo)}
                        className="small-link"
                      >
                        View all <ArrowUpRight size={14} />
                      </Link>
                    </div>
                    {demo ? (
                      <div className="activity-list">
                        {transactions.slice(0, 3).map((tx) => (
                          <div key={tx.id} className="activity-row">
                            <span className="activity-icon">
                              {tx.type === "Sell" ? (
                                <ArrowUpRight size={18} />
                              ) : (
                                <ArrowDownLeft size={18} />
                              )}
                            </span>
                            <span>
                              <strong>
                                {tx.type} {tx.asset}
                              </strong>
                              <small>{tx.source}</small>
                            </span>
                            <span>
                              <strong>{money(tx.value)}</strong>
                              <small>
                                {new Date(tx.date).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  timeZone: "UTC",
                                })}
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={ArrowLeftRight}
                        title="A clean slate"
                        detail="Your deposits and trades will appear here."
                      />
                    )}
                  </section>
                </div>
                <div className="workspace-note">
                  <ShieldCheck size={14} />
                  <span>
                    {demo
                      ? "Illustrative performance. Past results do not guarantee future returns."
                      : "Your workspace is ready. Trading and funding will be connected in the next stage."}
                  </span>
                  <span className="mono">TWAPTRADE / OVERVIEW</span>
                </div>
              </>
            )}
            {section === "wallet" && (
              <>
                <PageHeading
                  eyebrow="A HOME FOR YOUR ASSETS"
                  title="Your wallet."
                  description="A clear view of what you hold."
                >
                  <button
                    className="button button-ghost button-small"
                    onClick={() => setModal("withdraw")}
                  >
                    <ArrowUpRight size={16} /> Withdraw
                  </button>
                  <button
                    className="button button-small"
                    onClick={() => setModal("deposit")}
                  >
                    <Plus size={16} /> Add funds
                  </button>
                </PageHeading>
                <div className="wallet-summary panel">
                  <div>
                    <span className="muted small">Total balance</span>
                    <h2>
                      {demo ? money(48562.84) : "$0.00"} <span>USD</span>
                    </h2>
                    <span className="positive small">
                      {demo ? "+$4,286.32 this month" : "Ready when you are"}
                    </span>
                  </div>
                  <div>
                    <span className="muted small">Available balance</span>
                    <strong>{demo ? money(3767.1) : "$0.00"}</strong>
                  </div>
                  <div>
                    <span className="muted small">Allocated to strategies</span>
                    <strong>{demo ? money(44795.74) : "$0.00"}</strong>
                  </div>
                  <Logo compact />
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Your assets</h2>
                    <span className="tag">USD VALUATION</span>
                  </div>
                  {demo ? (
                    <AssetTable />
                  ) : (
                    <Empty
                      icon={Wallet}
                      title="Make room for your first asset"
                      detail="Balances will appear here once funding is connected."
                    />
                  )}
                </section>
                <div className="wallet-detail-grid">
                  <div className="note-panel">
                    <ShieldCheck />
                    <h3>Funding, with clear boundaries.</h3>
                    <p>
                      Deposits and withdrawals will become available after your
                      wallet provider is connected. No funds can be moved from
                      this preview.
                    </p>
                  </div>
                  <Allocation demo={demo} />
                </div>
              </>
            )}
            {section === "transactions" && <Transactions demo={demo} />}
            {section === "bots" && (
              <>
                <PageHeading
                  eyebrow="YOUR STRATEGY, IN MOTION"
                  title="A home for your bots."
                  description="Your strategies, organized and in view."
                >
                  <button
                    className="button button-small"
                    onClick={() => setModal("bot")}
                  >
                    <Plus size={16} /> Create a bot
                  </button>
                </PageHeading>
                <div className="info-banner">
                  <Bot size={19} />
                  <span>
                    Bot execution is coming next. Strategy settings will follow
                    your trading rules.
                  </span>
                </div>
                <div className="bot-summary">
                  <div>
                    <span className="muted small">Strategies in view</span>
                    <strong>{demo ? "03" : "00"}</strong>
                  </div>
                  <div>
                    <span className="muted small">Live bots</span>
                    <strong>00</strong>
                  </div>
                  <div>
                    <span className="muted small">Workspace status</span>
                    <strong className="ready-text">Ready for your rules</strong>
                  </div>
                </div>
                {demo ? (
                  <div className="bots-grid">
                    {assets.slice(0, 3).map((a, i) => (
                      <div className="panel bot-card" key={a.symbol}>
                        <div className="row-between">
                          <span className={`coin ${a.class}`}>{a.icon}</span>
                          <span className="status neutral">Preview</span>
                        </div>
                        <h2>{a.symbol} strategy</h2>
                        <p>
                          {a.symbol} / USDT <span>•</span> Sample strategy
                        </p>
                        <div className="bot-chart">
                          <Chart
                            mini
                            period={i === 1 ? "1W" : "1M"}
                            gradientId={`bot-${a.symbol}-gradient`}
                          />
                        </div>
                        <div className="row-between">
                          <span className="muted small">
                            Illustrative return
                          </span>
                          <strong className="positive">
                            {["+12.48%", "+8.32%", "+6.71%"][i]}
                          </strong>
                        </div>
                        <div className="row-between bot-allocation">
                          <span className="muted small">Sample allocation</span>
                          <span>{money(a.value)}</span>
                        </div>
                        <button
                          className="button button-ghost full-width"
                          onClick={() => setModal("bot")}
                        >
                          View strategy <ArrowUpRight size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <section className="panel">
                    <Empty
                      icon={Bot}
                      title="Your strategy belongs here"
                      detail="Once your trading rules are defined, you’ll create and manage your bots in this space."
                    />
                  </section>
                )}
                <div className="bot-next">
                  <div className="strategy-icon">
                    <SlidersHorizontal />
                  </div>
                  <div>
                    <h3>Good strategies start with clear rules.</h3>
                    <p>
                      Markets, execution logic, limits, and risk controls will
                      be defined together.
                    </p>
                  </div>
                </div>
              </>
            )}
            {section === "analytics" && <Analytics demo={demo} />}
            {section === "referrals" && (
              <Referrals demo={demo} account={account} loading={loading} />
            )}
            {section === "settings" && (
              <SettingsPage
                demo={demo}
                name={name}
                email={
                  account?.profile.email || user?.email || "alex@example.com"
                }
                account={account}
                saveAccount={saveAccount}
              />
            )}
          </div>
          <footer className="workspace-footer">
            <span>Thoughtfully built. Always in motion.</span>
            <span>© {new Date().getFullYear()} TwapTrade</span>
          </footer>
        </SidebarInset>
      </SidebarProvider>
      <Dialog open={!!modal} onOpenChange={(v) => !v && setModal("")}>
        <DialogContent className="app-dialog">
          <DialogHeader>
            <span className="dialog-symbol">
              {modal === "bot" ? <Bot /> : <Wallet />}
            </span>
            <DialogTitle>
              {modal === "bot"
                ? "Your strategy comes next."
                : modal === "deposit"
                  ? "Make room for your next move."
                  : "Withdraw with confidence."}
            </DialogTitle>
            <DialogDescription>
              {modal === "bot"
                ? "This workspace is ready for your bot logic. Market pairs, entry rules, execution timing, and risk limits will be configured when your strategy is defined."
                : "Your wallet provider has not been connected yet. Funding and withdrawals will become available once the payment and wallet flows are configured."}
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-details">
            {modal === "bot" ? (
              <>
                <span>
                  <Check size={15} /> A dedicated home for every strategy
                </span>
                <span>
                  <Check size={15} /> Performance and activity views prepared
                </span>
                <span>
                  <Clock size={15} /> Execution rules to be defined
                </span>
              </>
            ) : (
              <>
                <span>
                  <ShieldCheck size={15} /> No money moves in this preview
                </span>
                <span>
                  <Clock size={15} /> Wallet connection is the next step
                </span>
              </>
            )}
          </div>
          <button className="button full-width" onClick={() => setModal("")}>
            Got it <ArrowRight size={17} />
          </button>
        </DialogContent>
      </Dialog>
      {welcome && (
        <div className="welcome-overlay" role="status" aria-live="polite">
          <Logo />
          <div className="welcome-content">
            <span className="eyebrow">YOUR NEXT CHAPTER IS OPEN</span>
            <h1>
              {welcome},<br />
              <span className="accent-text">{displayName}.</span>
            </h1>
            <p>Let’s put things in perspective.</p>
            <div className="welcome-chart">
              <Chart gradientId="welcome-gradient" />
            </div>
            <span className="welcome-loading">
              Bringing your workspace into view<span>…</span>
            </span>
          </div>
          <button className="text-link" onClick={() => setWelcome(null)}>
            Enter workspace <ArrowRight size={16} />
          </button>
        </div>
      )}
      <Toaster
        position="bottom-right"
        theme="system"
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
          },
        }}
      />
    </>
  );
}
function AppSidebar({
  section,
  demo,
  name,
}: {
  section: string;
  demo: boolean;
  name: string;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar className="app-sidebar">
      <SidebarHeader>
        <div className="sidebar-brand">
          <Logo />
        </div>
        <div className="workspace-switch">
          <span className="workspace-initial">T</span>
          <span>
            TwapTrade workspace
            <small>{demo ? "Demo account" : "Personal account"}</small>
          </span>
          <ChevronDown size={14} />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <div className="sidebar-label">WORKSPACE</div>
          <SidebarMenu>
            {nav.map((item) => (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  asChild
                  isActive={section === item.id}
                  className="app-nav-link"
                >
                  <Link
                    href={href(item.id, demo)}
                    onClick={() => setOpenMobile(false)}
                    aria-current={section === item.id ? "page" : undefined}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                    {item.id === "bots" && (
                      <span className="nav-badge">{demo ? 3 : 0}</span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Link
          href={href("referrals", demo)}
          className="referral-promo"
          onClick={() => setOpenMobile(false)}
        >
          <Gift size={22} />
          <strong>Better, together.</strong>
          <p>Invite your circle to TwapTrade.</p>
          <span>
            Your referrals <ArrowUpRight size={14} />
          </span>
        </Link>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={section === "referrals"}
              className="app-nav-link"
            >
              <Link
                href={href("referrals", demo)}
                onClick={() => setOpenMobile(false)}
              >
                <Gift size={18} /> Referrals
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={section === "settings"}
              className="app-nav-link"
            >
              <Link
                href={href("settings", demo)}
                onClick={() => setOpenMobile(false)}
              >
                <Settings size={18} /> Settings
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="sidebar-user">
          <span className="avatar">{name.slice(0, 2).toUpperCase()}</span>
          <span>
            <strong>{name}</strong>
            <small>{demo ? "Demo account" : "Personal account"}</small>
          </span>
          <a
            href={demo ? "/login" : "/signout-with-chatgpt?return_to=%2Flogin"}
            target="_top"
            aria-label={demo ? "Exit demo" : "Sign out"}
          >
            <LogOut size={16} />
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
function Metrics({
  demo,
  hidden = false,
}: {
  demo: boolean;
  hidden?: boolean;
}) {
  const metrics = [
    {
      label: "Total portfolio value",
      value: demo ? "$48,562.84" : "$0.00",
      detail: demo ? "+9.68%" : "No assets yet",
      secondary: "this month",
      icon: Wallet,
    },
    {
      label: "Total profit / loss",
      value: demo ? "+$4,286.32" : "$0.00",
      detail: demo ? "+12.48%" : "No trading activity",
      secondary: "all time",
      icon: TrendingUp,
    },
    {
      label: "Available balance",
      value: demo ? "$3,767.10" : "$0.00",
      detail: demo ? "7.76% of portfolio" : "Ready for funding",
      secondary: "",
      icon: Layers,
    },
    {
      label: "Active bots",
      value: "0",
      detail: demo ? "3 sample strategies" : "Your next chapter",
      secondary: "",
      icon: Bot,
    },
  ];
  return (
    <div className="metrics-grid">
      {metrics.map((m, i) => (
        <section
          className={`metric ${i === 0 ? "metric-main" : ""}`}
          key={m.label}
        >
          <div className="row-between">
            <span>{m.label}</span>
            <m.icon size={16} />
          </div>
          <strong>{hidden && i !== 3 ? "••••••" : m.value}</strong>
          <div>
            <span className={i < 2 && demo ? "positive" : "muted"}>
              {i < 2 && demo && <ArrowUpRight size={12} />} {m.detail}
            </span>
            <small>{m.secondary}</small>
          </div>
        </section>
      ))}
    </div>
  );
}
function PortfolioPanel({
  demo,
  hidden = false,
}: {
  demo: boolean;
  hidden?: boolean;
}) {
  const [period, setPeriod] = useState("1M");
  const values: Record<string, string> = {
    "1D": "+$612.40",
    "1W": "+$1,432.18",
    "1M": "+$4,286.32",
    "1Y": "+$5,394.18",
    ALL: "+$5,394.18",
  };
  return (
    <section className="panel portfolio-panel">
      <div className="panel-heading">
        <div>
          <h2>Portfolio performance</h2>
          <span className="muted small">
            {demo
              ? "Your portfolio over time"
              : "Your performance will take shape here"}
          </span>
        </div>
        <div className="period-control" aria-label="Chart period">
          {["1D", "1W", "1M", "1Y", "ALL"].map((p) => (
            <button
              key={p}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {demo ? (
        <>
          <div className="performance-total">
            {hidden ? "••••••" : values[period]}{" "}
            <span className="positive">
              <ArrowUpRight size={13} />
              {period === "1D"
                ? "1.28%"
                : period === "1W"
                  ? "3.04%"
                  : period === "1M"
                    ? "9.68%"
                    : "12.48%"}
            </span>
          </div>
          <div className="dashboard-chart">
            <div className="chart-scale">
              <span>$50,000</span>
              <span>$47,000</span>
              <span>$44,000</span>
              <span>$41,000</span>
            </div>
            <Chart key={period} period={period} />
          </div>
          <div className="dashboard-chart-dates">
            {(period === "1D"
              ? ["00:00", "06:00", "12:00", "18:00", "23:59"]
              : period === "1W"
                ? ["MON", "TUE", "WED", "THU", "FRI"]
                : period === "1M"
                  ? ["SEP 01", "SEP 08", "SEP 15", "SEP 22", "SEP 30"]
                  : ["OCT", "JAN", "APR", "JUL", "SEP"]
            ).map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="chart-key">
            <span />
            <span>Portfolio value</span>
            <small>Sample performance · USD</small>
          </div>
        </>
      ) : (
        <Empty
          icon={ChartNoAxesCombined}
          title="Perspective starts with your first move"
          detail="A performance chart will appear once trading activity is available."
        />
      )}
    </section>
  );
}
function Allocation({
  demo,
  hidden = false,
}: {
  demo: boolean;
  hidden?: boolean;
}) {
  return (
    <section className="panel allocation-panel">
      <div className="panel-heading">
        <h2>Asset allocation</h2>
        <span className="tag">{demo ? "4 ASSETS" : "0 ASSETS"}</span>
      </div>
      <div
        className={`allocation-ring ${demo ? "" : "empty-ring"}`}
        role="img"
        aria-label={
          demo
            ? "Bitcoin 53%, Ethereum 26%, Solana 13%, Tether 8%"
            : "No assets allocated"
        }
      >
        <div>
          <span className="muted">Total assets</span>
          <strong>{hidden ? "•••" : demo ? "$48.56k" : "$0.00"}</strong>
          <small>Portfolio distribution</small>
        </div>
      </div>
      <div className="allocation-legend">
        {(demo ? assets : []).map((a, i) => (
          <div key={a.symbol}>
            <span className={`legend-dot dot-${i}`} />
            <strong>{a.name}</strong>
            <span>{a.allocation}%</span>
          </div>
        ))}
        {!demo && (
          <p className="muted small">Your asset mix will appear here.</p>
        )}
      </div>
    </section>
  );
}
function Empty({
  icon: Icon,
  title,
  detail,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
function AssetTable() {
  return (
    <Table className="data-table">
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Balance</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>24h change</TableHead>
          <TableHead>Allocation</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((a) => (
          <TableRow key={a.symbol}>
            <TableCell>
              <div className="asset-name">
                <span className={`coin ${a.class}`}>{a.icon}</span>
                <span>
                  <strong>{a.name}</strong>
                  <small>{a.symbol}</small>
                </span>
              </div>
            </TableCell>
            <TableCell>
              {a.amount} <span className="muted">{a.symbol}</span>
            </TableCell>
            <TableCell>{money(a.value)}</TableCell>
            <TableCell
              className={
                a.symbol === "SOL"
                  ? "negative"
                  : a.symbol === "USDT"
                    ? "muted"
                    : "positive"
              }
            >
              {a.change}
            </TableCell>
            <TableCell>
              <div className="allocation-bar">
                <span style={{ width: `${a.allocation}%` }} />
              </div>
              <span className="muted small">{a.allocation}%</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
function Transactions({ demo }: { demo: boolean }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<(typeof transactions)[0] | null>(
    null,
  );
  const filtered = (demo ? transactions : []).filter(
    (t) =>
      (type === "all" || t.type === type) &&
      (status === "all" || t.status === status) &&
      `${t.id} ${t.asset} ${t.symbol} ${t.source}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function exportCsv() {
    const text = [
      "ID,Type,Asset,Amount,Value USD,Date UTC,Status,Source",
      ...filtered.map((t) =>
        [
          t.id,
          t.type,
          t.symbol,
          `"${t.amount}"`,
          t.value,
          t.date,
          t.status,
          t.source,
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "twaptrade-transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Transaction export downloaded.");
  }
  return (
    <>
      <PageHeading
        eyebrow="EVERY MOVE, ACCOUNTED FOR"
        title="Your activity. In detail."
        description="The complete picture of your deposits, withdrawals, and trades."
      >
        <button
          className="button button-ghost button-small"
          onClick={exportCsv}
        >
          <Download size={16} /> Export CSV
        </button>
      </PageHeading>
      <section className="panel">
        <div className="transaction-filters">
          <div className="search-input">
            <Search size={16} />
            <Input
              aria-label="Search transactions"
              placeholder="Search asset or transaction…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger aria-label="Filter by transaction type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              {["all", "Buy", "Sell", "Deposit", "Withdrawal"].map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All types" : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by transaction status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Completed">Completed</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {filtered.length ? (
          <Table className="data-table transaction-table">
            <TableHeader>
              <TableRow>
                {[
                  "Transaction",
                  "Asset",
                  "Amount",
                  "Value",
                  "Date",
                  "Status",
                  "",
                ].map((v, i) => (
                  <TableHead key={i}>{v}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="asset-name">
                      <span className="activity-icon">
                        {t.type === "Sell" || t.type === "Withdrawal" ? (
                          <ArrowUpRight size={18} />
                        ) : (
                          <ArrowDownLeft size={18} />
                        )}
                      </span>
                      <span>
                        <strong>{t.type}</strong>
                        <small>{t.id}</small>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{t.symbol}</TableCell>
                  <TableCell>{t.amount}</TableCell>
                  <TableCell>{money(t.value)}</TableCell>
                  <TableCell>
                    {new Date(t.date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                    <small className="table-small">
                      {new Date(t.date).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </small>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`status ${t.status === "Pending" ? "pending" : ""}`}
                    >
                      {t.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      className="icon-button"
                      onClick={() => setSelected(t)}
                      aria-label={`View transaction ${t.id}`}
                    >
                      <ArrowUpRight size={15} />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty
            icon={Search}
            title={
              demo ? "No matching transactions" : "Your activity starts here"
            }
            detail={
              demo
                ? "Try another asset or clear your filters."
                : "Transactions will appear when funding and trading are connected."
            }
          />
        )}
        <div className="table-footer">
          <span>
            {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
            {demo ? " · Sample data" : ""}
          </span>
          {(query || type !== "all" || status !== "all") && (
            <button
              onClick={() => {
                setQuery("");
                setType("all");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </section>
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>Transaction details</DialogTitle>
            <DialogDescription>
              {selected?.id} · Illustrative transaction
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="detail-list">
              {Object.entries({
                Type: selected.type,
                Asset: selected.asset,
                Amount: selected.amount,
                Value: money(selected.value),
                Status: selected.status,
                Source: selected.source,
                "Time (UTC)": selected.date.replace("T", " ").replace("Z", ""),
              }).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function Analytics({ demo }: { demo: boolean }) {
  const [period, setPeriod] = useState("month");
  const month = [
    32, 58, 41, 74, 48, 35, 61, 85, 66, 49, 80, 58, 93, 72, 87, 69, 98, 82, 75,
    94, 66, 81, 88, 72, 92, 80, 97, 74, 83, 99,
  ];
  const week = [45, 70, 52, 85, 63, 77, 95];
  return (
    <>
      <PageHeading
        eyebrow="UNDERSTAND YOUR EDGE"
        title="Look a little closer."
        description="Performance, allocation, and activity in perspective."
      >
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger aria-label="Analytics period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="week">This week</SelectItem>
          </SelectContent>
        </Select>
      </PageHeading>
      <div className="metrics-grid analytics-metrics">
        {[
          {
            label: "Net performance",
            value: demo ? (period === "month" ? "+9.68%" : "+3.04%") : "—",
            detail: "Portfolio change",
          },
          {
            label: "Trading volume",
            value: demo
              ? period === "month"
                ? "$32,840.62"
                : "$8,412.38"
              : "$0.00",
            detail: "Total traded value",
          },
          {
            label: "Executed trades",
            value: demo ? (period === "month" ? "128" : "32") : "0",
            detail: "During this period",
          },
          {
            label: "Largest allocation",
            value: demo ? "Bitcoin" : "—",
            detail: demo ? "53% of portfolio" : "No assets yet",
          },
        ].map((m, i) => (
          <div className="metric" key={m.label}>
            <span className="muted small">{m.label}</span>
            <strong className={i === 0 ? "positive" : ""}>{m.value}</strong>
            <span className="muted small">{m.detail}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <PortfolioPanel demo={demo} />
        <Allocation demo={demo} />
      </div>
      <section className="panel volume-panel">
        <div className="panel-heading">
          <div>
            <h2>Trading volume</h2>
            <span className="muted small">Daily activity · USD</span>
          </div>
          <span className="tag">
            {period === "month" ? "30 DAYS" : "7 DAYS"}
          </span>
        </div>
        {demo ? (
          <>
            <div
              className="volume-chart"
              role="img"
              aria-label={`${period === "month" ? 30 : 7} days of illustrative trading volume`}
            >
              {(period === "month" ? month : week).map((n, i) => (
                <div
                  key={i}
                  style={{ height: `${n}%` }}
                  title={`Day ${i + 1}: illustrative volume`}
                >
                  <span />
                </div>
              ))}
            </div>
            <div className="chart-dates">
              <span>{period === "month" ? "SEP 01" : "MONDAY"}</span>
              <span>{period === "month" ? "SEP 15" : "THURSDAY"}</span>
              <span>{period === "month" ? "SEP 30" : "SUNDAY"}</span>
            </div>
          </>
        ) : (
          <Empty
            icon={ChartNoAxesCombined}
            title="Every trade adds perspective"
            detail="Your daily trading volume will appear here."
          />
        )}
      </section>
    </>
  );
}
function Referrals({
  demo,
  account,
  loading,
}: {
  demo: boolean;
  account: Account | null;
  loading: boolean;
}) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const code = account?.profile.referralCode;
  const link = code ? `${origin}/signup?ref=${code}` : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Referral link copied.");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error("Copy wasn’t available. Select and copy the link below.");
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="GOOD THINGS ARE BETTER SHARED"
        title="Bring your circle."
        description="Invite the people you trade ideas with."
      />
      <div className="referral-hero">
        <div className="referral-copy">
          <div className="referral-symbol">
            <Gift size={35} />
          </div>
          <h2>
            A little clarity.
            <br />
            Better, together.
          </h2>
          <p>
            Give your friends a direct path to TwapTrade.
            <br />
            Every successful invitation stays connected to you.
          </p>
        </div>
        <div className="referral-link-panel">
          <h3>Your personal invitation</h3>
          <p>
            Share your unique link. Referrals are recorded when a new account
            joins through it.
          </p>
          {demo ? (
            <div className="referral-demo">
              <LockKeyhole size={20} />
              <span>Create an account to get your own referral link.</span>
              <Link className="button full-width" href="/signup">
                Get your referral link <ArrowUpRight size={16} />
              </Link>
            </div>
          ) : (
            <>
              <label htmlFor="referral-link">Referral link</label>
              <Input
                id="referral-link"
                readOnly
                value={loading ? "Loading your invitation…" : link}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="button full-width"
                disabled={!link}
                onClick={copy}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                {copied ? "Link copied" : "Copy invitation"}
              </button>
              {code && (
                <small>
                  Your code: <strong>{code}</strong>
                </small>
              )}
            </>
          )}
        </div>
      </div>
      <div className="referral-stats">
        <div>
          <span className="muted small">Friends joined</span>
          <strong>{account?.referralCount || 0}</strong>
        </div>
        <div>
          <span className="muted small">Your invitation</span>
          <strong className="ready-text">
            {demo
              ? "Create an account"
              : loading
                ? "Loading…"
                : code
                  ? "Ready to share"
                  : "Unavailable"}
          </strong>
        </div>
        <div>
          <span className="muted small">Rewards</span>
          <strong className="ready-text">To be announced</strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Your referrals</h2>
          <span className="tag">VERIFIED SIGN-UPS</span>
        </div>
        {account?.referrals.length ? (
          <Table className="data-table">
            <TableHeader>
              <TableRow>
                <TableHead>Referral</TableHead>
                <TableHead>Date joined</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {account.referrals.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    Trader {String(account.referralCount - i).padStart(2, "0")}
                  </TableCell>
                  <TableCell>
                    {new Date(r.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <span className="status">Joined</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Empty
            icon={Gift}
            title="Your circle starts with one invitation"
            detail="When someone creates a new account with your link, you’ll see their referral here."
          />
        )}
      </section>
      <div className="workspace-note">
        <ShieldCheck size={14} /> Referral links apply once to new accounts.
        Self-referrals are excluded. Reward terms will be defined before launch.
      </div>
    </>
  );
}
function SettingsPage({
  demo,
  name,
  email,
  account,
  saveAccount,
}: {
  demo: boolean;
  name: string;
  email: string;
  account: Account | null;
  saveAccount: (data: Record<string, unknown>) => Promise<Account>;
}) {
  const { prefs, setPrefs } = useAppearance();
  const [draftName, setDraftName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [securityMessage, setSecurityMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => setDraftName(name), [name]);
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (demo) {
      toast("You’re in the demo. Create an account to save your profile.");
      return;
    }
    setBusy(true);
    try {
      await saveAccount({ name: draftName });
      toast.success("Your profile has been updated.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function syncPreferences() {
    if (demo) {
      toast.success("Appearance saved on this device.");
      return;
    }
    setBusy(true);
    try {
      await saveAccount({ preferences: prefs });
      toast.success("Appearance saved to your account.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title="The details that make it yours."
        description="Your profile, your preferences, your peace of mind."
      />
      <Tabs defaultValue="appearance" className="settings-tabs">
        <TabsList variant="line">
          <TabsTrigger value="profile">
            <User size={16} /> Profile
          </TabsTrigger>
          <TabsTrigger value="appearance">
            <Palette size={16} /> Appearance
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck size={16} /> Security
          </TabsTrigger>
        </TabsList>
        <TabsContent value="appearance">
          <div className="settings-intro">
            <div>
              <h2>Your workspace, your signature.</h2>
              <p>Fine-tune the way TwapTrade looks and feels.</p>
            </div>
            <button
              className="button button-small"
              disabled={busy || (!demo && !account)}
              onClick={syncPreferences}
            >
              {busy ? "Saving…" : demo ? "Save appearance" : "Save to account"}
              <Check size={15} />
            </button>
          </div>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Theme</h3>
              <p>Find your focus, day or night.</p>
            </div>
            <RadioGroup
              className="theme-options"
              value={prefs.theme}
              onValueChange={(v) => setPrefs({ theme: v })}
              aria-label="Theme"
            >
              {[
                {
                  value: "dark",
                  label: "Dark",
                  detail: "A quieter view after hours",
                  icon: Moon,
                },
                {
                  value: "light",
                  label: "Light",
                  detail: "A fresh view of your day",
                  icon: Sun,
                },
                {
                  value: "system",
                  label: "System",
                  detail: "In sync with your device",
                  icon: Monitor,
                },
              ].map((t) => (
                <label
                  key={t.value}
                  className={`theme-option ${prefs.theme === t.value ? "selected" : ""}`}
                >
                  <div className={`theme-window ${t.value}`}>
                    <div />
                    <div>
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                  <div className="row-between">
                    <span>
                      <t.icon size={16} />
                      {t.label}
                    </span>
                    <RadioGroupItem value={t.value} id={`theme-${t.value}`} />
                  </div>
                  <small>{t.detail}</small>
                </label>
              ))}
            </RadioGroup>
          </section>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Accent color</h3>
              <p>A signature color, across your logo and workspace.</p>
            </div>
            <RadioGroup
              className="accent-options"
              value={prefs.accent}
              onValueChange={(v) => setPrefs({ accent: v })}
              aria-label="Accent color"
            >
              {["auto", "mint", "sky", "amber", "rose"].map((c) => (
                <label
                  key={c}
                  className={`accent-option ${prefs.accent === c ? "selected" : ""}`}
                >
                  <RadioGroupItem value={c} className="sr-only" />
                  {c === "auto" ? (
                    <span className="auto-swatches">
                      {["mint", "sky", "amber", "rose"].map((a) => (
                        <i key={a} className={`swatch ${a}`} />
                      ))}
                    </span>
                  ) : (
                    <span className={`swatch ${c}`} />
                  )}
                  <span>{c[0].toUpperCase() + c.slice(1)}</span>
                  {prefs.accent === c && <Check size={14} />}
                </label>
              ))}
            </RadioGroup>
            <p className="setting-help">
              <Sparkles size={13} /> Auto gives each login a fresh color and
              keeps it consistent throughout your session.
            </p>
          </section>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Layout density</h3>
              <p>A little breathing room, or a closer look.</p>
            </div>
            <ChoiceGroup
              value={prefs.density}
              onChange={(v) => setPrefs({ density: v })}
              label="Layout density"
              options={[
                {
                  value: "comfortable",
                  title: "Comfortable",
                  detail: "More space to focus",
                },
                {
                  value: "compact",
                  title: "Compact",
                  detail: "More information in view",
                },
              ]}
            />
          </section>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Motion</h3>
              <p>Set a pace that feels right.</p>
            </div>
            <ChoiceGroup
              value={prefs.motion}
              onChange={(v) => setPrefs({ motion: v })}
              label="Animation intensity"
              options={[
                {
                  value: "full",
                  title: "Full",
                  detail: "Fluid transitions and a warm welcome",
                },
                {
                  value: "reduced",
                  title: "Reduced",
                  detail: "A calmer, quieter experience",
                },
              ]}
            />
            <p className="setting-help">
              Your device’s reduced-motion preference is always respected.
            </p>
          </section>
        </TabsContent>
        <TabsContent value="profile">
          <div className="settings-intro">
            <div>
              <h2>A little about you.</h2>
              <p>The details behind your workspace.</p>
            </div>
          </div>
          <section className="panel profile-panel">
            <div className="profile-avatar-row">
              <span className="avatar profile-avatar">
                {name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <h3>{name}</h3>
                <p>{demo ? "Demo account" : "Personal account"}</p>
              </div>
            </div>
            <form onSubmit={saveProfile} className="settings-form">
              <label>
                Full name
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  required
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
              <label>
                Email address
                <Input value={email} type="email" readOnly />
                <small>Your email is managed by your sign-in provider.</small>
              </label>
              <button className="button" disabled={busy || (!demo && !account)}>
                {busy ? "Saving…" : "Save changes"}
                <Check size={16} />
              </button>
            </form>
          </section>
        </TabsContent>
        <TabsContent value="security">
          <div className="settings-intro">
            <div>
              <h2>A little more peace of mind.</h2>
              <p>Keep access to your workspace in your hands.</p>
            </div>
          </div>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Sign-in method</h3>
              <p>
                {demo
                  ? "You are browsing a demo account."
                  : "Your current account uses Sign in with ChatGPT."}
              </p>
            </div>
            <div className="security-method">
              <ShieldCheck size={22} />
              <div>
                <strong>
                  {demo ? "Demo workspace" : "ChatGPT authentication"}
                </strong>
                <p>
                  {demo
                    ? "No credentials are stored in this demo."
                    : "Your password and account recovery are managed by your identity provider."}
                </p>
              </div>
              <span className="status neutral">
                {demo ? "Preview" : "Connected"}
              </span>
            </div>
            {!demo && (
              <a
                href="https://chatgpt.com/#settings"
                target="_blank"
                rel="noopener noreferrer"
                className="text-link security-link"
              >
                Manage your sign-in account <ExternalLink size={15} />
              </a>
            )}
          </section>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Change password</h3>
              <p>
                Email account security will be available when email sign-in is
                connected.
              </p>
            </div>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                if (data.get("newPassword") !== data.get("confirmPassword")) {
                  setSecurityMessage("Your new passwords don’t match.");
                  return;
                }
                setSecurityMessage(
                  "Email password changes are not connected yet. Your current ChatGPT password is managed by your sign-in provider.",
                );
              }}
            >
              <label>
                Current password
                <div className="password-input">
                  <Input
                    type={showPassword ? "text" : "password"}
                    name="currentPassword"
                    required
                    autoComplete="current-password"
                    placeholder="Enter current password"
                  />
                  <button
                    type="button"
                    aria-label="Toggle password visibility"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <label>
                New password
                <Input
                  type={showPassword ? "text" : "password"}
                  name="newPassword"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  placeholder="At least 12 characters"
                />
              </label>
              <label>
                Confirm new password
                <Input
                  type={showPassword ? "text" : "password"}
                  name="confirmPassword"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  placeholder="Re-enter new password"
                />
              </label>
              {securityMessage && (
                <p role="alert" className="form-message">
                  {securityMessage}
                </p>
              )}
              <button className="button">
                Update password <ArrowRight size={16} />
              </button>
            </form>
          </section>
          <section className="setting-section">
            <div className="setting-label">
              <h3>Current session</h3>
              <p>Your active workspace session.</p>
            </div>
            <div className="security-method">
              <Monitor size={22} />
              <div>
                <strong>This browser</strong>
                <p>
                  {demo
                    ? "Demo preview"
                    : account
                      ? `Last sign-in: ${new Date(account.profile.lastLoginAt).toLocaleString()}`
                      : "Loading session…"}
                </p>
              </div>
              <a
                href={
                  demo ? "/login" : "/signout-with-chatgpt?return_to=%2Flogin"
                }
                target="_top"
                className="button button-ghost button-small"
              >
                <LogOut size={15} /> Sign out
              </a>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
function ChoiceGroup({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: { value: string; title: string; detail: string }[];
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      aria-label={label}
      className="choice-options"
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={`choice-option ${value === o.value ? "selected" : ""}`}
        >
          <div>
            <strong>{o.title}</strong>
            <small>{o.detail}</small>
          </div>
          <RadioGroupItem value={o.value} />
        </label>
      ))}
    </RadioGroup>
  );
}
