"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  appearanceOptions,
  defaultPreferences as defaults,
  validPreferences,
  readBrowserStorage,
  writeBrowserStorage,
  type Preferences,
} from "@/lib/appearance";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDownLeft,
  ChevronRight,
  Check,
  ShieldCheck,
  SlidersHorizontal,
  Activity,
  Menu,
  X,
  Command,
  Zap,
  Moon,
  Sun,
  Monitor,
  TrendingUp,
} from "lucide-react";

const ThemeContext = createContext({
  prefs: defaults,
  setPrefs: (_: Partial<Preferences>): boolean => true,
  persistPrefs: (): boolean => true,
  setSessionAccent: (_: string) => {},
});
const accents = ["mint", "sky", "amber", "rose"];
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, update] = useState(defaults);
  const [auto, setAuto] = useState("mint");
  const prefsRef = useRef(defaults);
  useEffect(() => {
    try {
      const p = JSON.parse(
        readBrowserStorage("localStorage", "twap-appearance") || "null",
      );
      const next = { ...defaults, ...validPreferences(p) };
      prefsRef.current = next;
      // Browser storage is read after hydration to preserve identical server/client markup.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      update(next);
    } catch {}
    const storedAccent = readBrowserStorage(
      "sessionStorage",
      "twap-session-accent",
    );
    const nextAccent = accents.includes(storedAccent || "")
      ? storedAccent!
      : "mint";
    setAuto(nextAccent);
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        prefs.theme === "system"
          ? query.matches
            ? "dark"
            : "light"
          : prefs.theme;
      document.documentElement.dataset.accent =
        prefs.accent === "auto" ? auto : prefs.accent;
      document.documentElement.dataset.density = prefs.density;
      document.documentElement.dataset.motion = prefs.motion;
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [prefs, auto]);
  function setPrefs(p: Partial<Preferences>) {
    const next = { ...prefsRef.current, ...validPreferences(p) };
    prefsRef.current = next;
    update(next);
    return writeBrowserStorage(
      "localStorage",
      "twap-appearance",
      JSON.stringify(next),
    );
  }
  function persistPrefs() {
    return writeBrowserStorage(
      "localStorage",
      "twap-appearance",
      JSON.stringify(prefsRef.current),
    );
  }
  function setSessionAccent(next: string) {
    if (!accents.includes(next)) return;
    writeBrowserStorage("sessionStorage", "twap-session-accent", next);
    setAuto(next);
  }
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const allowed = appearanceOptions;
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: "set_workspace_appearance",
            title: "Set workspace appearance",
            description:
              "Change the device-local theme, accent, density, or motion using the same appearance preferences as Settings. Does not save preferences to an account.",
            inputSchema: {
              type: "object",
              properties: Object.fromEntries(
                Object.entries(allowed).map(([key, values]) => [
                  key,
                  { type: "string", enum: values },
                ]),
              ),
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            async execute(input: unknown) {
              if (!input || typeof input !== "object" || Array.isArray(input))
                throw new Error("Expected an appearance object");
              for (const [k, v] of Object.entries(input)) {
                if (
                  !Object.hasOwn(allowed, k) ||
                  typeof v !== "string" ||
                  !allowed[k].includes(v)
                )
                  throw new Error("Invalid appearance preference");
              }
              const persisted = setPrefs(input as Partial<Preferences>);
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              return {
                preferences: { ...prefsRef.current },
                savedOn: persisted ? "this device" : "this session only",
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  return (
    <ThemeContext.Provider
      value={{ prefs, setPrefs, persistPrefs, setSessionAccent }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export const useAppearance = () => useContext(ThemeContext);
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="TwapTrade home">
      <svg
        className="brand-mark"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 8h25l-5 6H15L8 27H1L12 8M20 17h8l-6 10h-8l6-10Z"
          fill="currentColor"
        />
      </svg>
      {!compact && (
        <span>
          twap<span className="brand-light">trade</span>
          <span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
export function Chart({
  snapshots = [],
  gradientId = "portfolio-gradient",
}: {
  snapshots?: { value_cents: number; recorded_at: string }[];
  gradientId?: string;
}) {
  if (snapshots.length < 2)
    return (
      <div className="real-empty chart-empty">
        <Activity size={26} />
        <h3>
          {snapshots.length
            ? "One portfolio observation recorded"
            : "No portfolio history yet"}
        </h3>
        <p>
          {snapshots.length
            ? "A trend appears after a second valuation."
            : "Your chart will appear when portfolio valuations are recorded."}
        </p>
      </div>
    );
  const values = snapshots.map((s) => s.value_cents),
    min = Math.min(...values),
    max = Math.max(...values),
    spread = max - min || Math.max(Math.abs(max) * 0.1, 100);
  const times = snapshots.map((s) => new Date(s.recorded_at).getTime());
  const duration = times[times.length - 1] - times[0];
  const line = values
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${duration ? ((times[i] - times[0]) / duration) * 1000 : (i / (values.length - 1)) * 1000},${220 - ((v - min) / spread) * 190}`,
    )
    .join(" ");
  const format = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(v / 100);
  return (
    <div className="real-chart">
      <div className="row-between small muted">
        <span>{format(max)}</span>
        <span>{snapshots.length} observations</span>
      </div>
      <svg
        className="portfolio-chart"
        viewBox="0 0 1000 260"
        role="img"
        aria-label={`Recorded portfolio values from ${format(values[0])} to ${format(values[values.length - 1])}`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity=".19" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[30, 95, 160, 225].map((y) => (
          <line
            key={y}
            x1="0"
            x2="1000"
            y1={y}
            y2={y}
            stroke="var(--border)"
            strokeDasharray="3 7"
          />
        ))}
        <path d={`${line} L1000,260 L0,260 Z`} fill={`url(#${gradientId})`} />
        <path
          d={line}
          stroke="var(--brand)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
      </svg>
      <div className="row-between small muted">
        <span>{new Date(snapshots[0].recorded_at).toLocaleDateString()}</span>
        <span>
          {new Date(
            snapshots[snapshots.length - 1].recorded_at,
          ).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
export function Landing() {
  const [menu, setMenu] = useState(false);
  return (
    <div className="landing">
      <header className="site-header">
        <Logo />
        <nav
          className={menu ? "site-nav open" : "site-nav"}
          aria-label="Main navigation"
        >
          <a href="#platform" onClick={() => setMenu(false)}>
            Platform
          </a>
          <a href="#approach" onClick={() => setMenu(false)}>
            Our approach
          </a>
          <a href="#your-workspace" onClick={() => setMenu(false)}>
            Made for you
          </a>
        </nav>
        <div className="header-actions">
          <Link href="/login" className="text-link">
            Log in
          </Link>
          <Link href="/signup" className="button button-small">
            Get started <ArrowUpRight size={16} />
          </Link>
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle navigation"
            aria-expanded={menu}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="small-line" /> PRECISION MEETS POSSIBILITY
            </div>
            <h1>
              Your strategy.
              <br />
              Always
              <br />
              <span className="accent-text">in motion.</span>
            </h1>
            <p>
              A considered way to automate your trading.
              <br className="desktop-break" /> One clear view of your bots,
              assets, and every move.
            </p>
            <div className="hero-buttons">
              <Link href="/signup" className="button">
                Build your workspace <ArrowUpRight size={19} />
              </Link>
              <Link href="/app/dashboard" className="button button-ghost">
                Open your dashboard <ArrowRight size={18} />
              </Link>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={15} />
              <span>Your strategy. Your control.</span>
              <span className="tiny-divider" />
              <span>Designed for clarity.</span>
            </div>
          </div>
          <div className="hero-visual">
            <div className="visual-topline">
              <span>THE BIGGER PICTURE</span>
              <span className="mono">01 — PORTFOLIO</span>
            </div>
            <div className="hero-terminal">
              <div className="terminal-top">
                <Logo compact />
                <span>Your portfolio, in perspective</span>
                <span className="tag">PRIVATE</span>
              </div>
              <div className="landing-private">
                <span className="eyebrow">YOUR WORKSPACE AWAITS</span>
                <h2>
                  A place for
                  <br />
                  <span className="accent-text">every move.</span>
                </h2>
                <div className="landing-workspace-list">
                  <span>
                    <Activity size={20} /> Your bots
                  </span>
                  <span>
                    <ShieldCheck size={20} /> Your assets
                  </span>
                  <span>
                    <SlidersHorizontal size={20} /> Your perspective
                  </span>
                </div>
                <Link href="/login" className="text-link">
                  Sign in to view your portfolio <ArrowUpRight size={16} />
                </Link>
              </div>
            </div>
            <div className="visual-caption">
              <span className="caption-mark">✳</span>
              <p>
                Less noise.
                <br />
                <strong>More intention.</strong>
              </p>
              <span>BUILT FOR THE LONG VIEW ↗</span>
            </div>
          </div>
        </section>
        <div className="principle-strip">
          <span>
            <Command size={18} /> One connected workspace
          </span>
          <span>
            <Activity size={18} /> A clearer view of performance
          </span>
          <span>
            <SlidersHorizontal size={18} /> Built around your preferences
          </span>
          <span>
            <ShieldCheck size={18} /> You stay in control
          </span>
        </div>
        <section id="platform" className="platform-section">
          <div className="section-intro">
            <div>
              <span className="eyebrow">A WORKSPACE THAT WORKS WITH YOU</span>
              <h2>
                Every move.
                <br />
                One clear picture.
              </h2>
            </div>
            <p>
              Bring your trading into focus. From your first strategy to your
              entire portfolio, the details have a place.
            </p>
          </div>
          <div className="feature-grid">
            <Link href="/app/dashboard" className="feature feature-main">
              <span className="feature-number">01 / SEE THE WHOLE PICTURE</span>
              <h3>
                A little perspective
                <br />
                goes a long way.
              </h3>
              <p>
                Portfolio, performance, and recent activity.
                <br />
                Everything that matters, at a glance.
              </p>
              <div className="feature-chart">
                <div className="feature-workspace-labels">
                  <span>Portfolio</span>
                  <span>Activity</span>
                  <span>Allocations</span>
                </div>
              </div>
              <ArrowUpRight className="feature-arrow" />
            </Link>
            <Link href="/app/bots" className="feature">
              <span className="feature-number">02 / FIND YOUR RHYTHM</span>
              <div className="feature-icon">
                <Activity size={34} />
              </div>
              <h3>Built for your strategy.</h3>
              <p>
                A dedicated home for your bots.
                <br />
                Deploy from a curated catalog.
              </p>
              <ArrowUpRight className="feature-arrow" />
            </Link>
            <Link href="/app/analytics" className="feature">
              <span className="feature-number">
                03 / UNDERSTAND THE DETAILS
              </span>
              <div className="feature-icon">
                <TrendingUp size={34} />
              </div>
              <h3>Clarity in every number.</h3>
              <p>
                Follow allocations, review activity,
                <br />
                and see performance in context.
              </p>
              <ArrowUpRight className="feature-arrow" />
            </Link>
          </div>
        </section>
        <section id="approach" className="approach-section">
          <div className="eyebrow">THOUGHTFUL BY DESIGN</div>
          <h2>
            Trading is complex.
            <br />
            <span>Your workspace shouldn’t be.</span>
          </h2>
          <div className="approach-points">
            <div>
              <span>01</span>
              <h3>Intentional, down to the detail.</h3>
              <p>
                Clean views and considered interactions help you focus on your
                next decision.
              </p>
            </div>
            <div>
              <span>02</span>
              <h3>Your controls stay close.</h3>
              <p>
                Keep account security, preferences, and activity within easy
                reach.
              </p>
            </div>
            <div>
              <span>03</span>
              <h3>Room for your own approach.</h3>
              <p>
                A flexible foundation for the strategies and trading rules you
                choose.
              </p>
            </div>
          </div>
        </section>
        <section id="your-workspace" className="personal-section">
          <div>
            <span className="eyebrow">MAKE YOURSELF AT HOME</span>
            <h2>
              Your workspace.
              <br />
              <span className="accent-text">Your signature.</span>
            </h2>
            <p>
              Pick your palette. Find your density.
              <br />
              Set the pace. Make every login feel like you.
            </p>
            <Link href="/app/settings" className="text-link">
              Find your look <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="personal-preview">
            <div className="row-between">
              <span>Appearance</span>
              <SlidersHorizontal size={19} />
            </div>
            <div className="theme-mini">
              <span>
                <Moon /> Dark
              </span>
              <span>
                <Sun /> Light
              </span>
              <span>
                <Monitor /> System
              </span>
            </div>
            <span className="muted small">A signature accent</span>
            <div className="swatches">
              {accents.map((c) => (
                <span key={c} className={`swatch ${c}`} />
              ))}
            </div>
            <div className="personal-note">
              <Check size={16} /> Your logo and workspace, perfectly in sync.
            </div>
          </div>
        </section>
        <section className="closing-cta">
          <span className="eyebrow">YOUR NEXT MOVE STARTS HERE</span>
          <h2>
            A clearer head.
            <br />A sharper workspace.
          </h2>
          <Link href="/signup" className="button">
            Make it yours <ArrowUpRight size={19} />
          </Link>
          <p>Explore the experience before connecting your trading.</p>
        </section>
      </main>
      <footer className="site-footer">
        <div className="row-between">
          <Logo />
          <span>Precision. Perspective. TwapTrade.</span>
          <Link href="/app/dashboard">
            Open your workspace <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} TwapTrade</span>
          <p>Trading involves risk. Returns are not guaranteed.</p>
        </div>
      </footer>
    </div>
  );
}
