"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
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

type Preferences = {
  theme: string;
  accent: string;
  density: string;
  motion: string;
};
const defaults: Preferences = {
  theme: "dark",
  accent: "mint",
  density: "comfortable",
  motion: "full",
};
const ThemeContext = createContext({
  prefs: defaults,
  setPrefs: (_: Partial<Preferences>) => {},
  rotateAccent: () => {},
});
const accents = ["mint", "sky", "amber", "rose"];
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, update] = useState(defaults);
  const [auto, setAuto] = useState("mint");
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem("twap-appearance") || "null");
      if (p) update({ ...defaults, ...p });
      setAuto(sessionStorage.getItem("twap-session-accent") || "mint");
    } catch {}
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
    update((old) => {
      const next = { ...old, ...p };
      localStorage.setItem("twap-appearance", JSON.stringify(next));
      return next;
    });
  }
  function rotateAccent() {
    const current = sessionStorage.getItem("twap-session-accent") || "mint";
    const other = accents.filter((a) => a !== current);
    const next = other[Math.floor(Math.random() * other.length)];
    sessionStorage.setItem("twap-session-accent", next);
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
    const allowed: Record<string, string[]> = {
      theme: ["dark", "light", "system"],
      accent: ["auto", "mint", "sky", "amber", "rose"],
      density: ["comfortable", "compact"],
      motion: ["full", "reduced"],
    };
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
                if (!allowed[k]?.includes(String(v)))
                  throw new Error("Invalid appearance preference");
              }
              setPrefs(input as Partial<Preferences>);
              await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              );
              return {
                preferences: JSON.parse(
                  localStorage.getItem("twap-appearance") || "{}",
                ),
                savedOn: "this device",
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
    <ThemeContext.Provider value={{ prefs, setPrefs, rotateAccent }}>
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
const points = [
  213, 210, 220, 199, 203, 178, 190, 169, 180, 157, 161, 168, 155, 143, 151,
  126, 135, 116, 121, 96, 108, 78, 84, 58, 73, 51, 61, 36, 42, 18, 25, 9,
];
export function Chart({
  mini = false,
  period = "1M",
  gradientId = "portfolio-gradient",
}: {
  mini?: boolean;
  period?: string;
  gradientId?: string;
}) {
  const id = gradientId;
  const offset = period === "1W" ? 19 : period === "1D" ? 37 : 0;
  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(i * 1000) / (points.length - 1)},${Math.max(10, p + Math.sin(i + offset) * offset)}`,
    )
    .join(" ");
  return (
    <svg
      className={`portfolio-chart ${mini ? "mini-chart" : ""}`}
      viewBox="0 0 1000 260"
      role="img"
      aria-label={`Illustrative portfolio performance over ${period}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity=".19" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {!mini &&
        [20, 90, 160, 230].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="1000"
            y2={y}
            stroke="var(--border)"
            strokeDasharray="3 7"
          />
        ))}
      <path d={`${line} L1000,260 L0,260 Z`} fill={`url(#${id})`} />
      <path
        className="chart-stroke"
        d={line}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={mini ? 4 : 2.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      <circle
        cx="1000"
        cy={Math.max(10, 9 + Math.sin(31 + offset) * offset)}
        r="5"
        fill="var(--brand)"
      />
    </svg>
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
              <Link
                href="/app/dashboard?demo=1"
                className="button button-ghost"
              >
                Explore the dashboard <ArrowRight size={18} />
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
                <span className="tag">ILLUSTRATIVE</span>
              </div>
              <div className="terminal-balance">
                <span>
                  Total portfolio value <ArrowUpRight size={15} />
                </span>
                <strong>
                  $48,562<span>.84</span>
                </strong>
                <div className="gain">
                  <TrendingUp size={15} /> +$4,286.32{" "}
                  <span>(9.68%) this month</span>
                </div>
              </div>
              <div className="hero-chart">
                <div className="chart-callout">
                  <span>A little more perspective.</span>
                  <strong>A lot more control.</strong>
                </div>
                <Chart />
              </div>
              <div className="chart-dates">
                <span>01 SEP</span>
                <span>10 SEP</span>
                <span>20 SEP</span>
                <span>30 SEP</span>
              </div>
              <div className="terminal-bottom">
                <div>
                  <span className="coin bitcoin">₿</span>
                  <div>
                    <strong>BTC / USDT</strong>
                    <small>Strategy overview</small>
                  </div>
                </div>
                <span className="mini-spark">▁▂▁▃▂▄▃▅▆▅█</span>
                <span className="positive">
                  +12.48% <ArrowUpRight size={14} />
                </span>
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
            <Link href="/app/dashboard?demo=1" className="feature feature-main">
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
                <Chart mini gradientId="landing-feature-gradient" />
              </div>
              <ArrowUpRight className="feature-arrow" />
            </Link>
            <Link href="/app/bots?demo=1" className="feature">
              <span className="feature-number">02 / FIND YOUR RHYTHM</span>
              <div className="feature-icon">
                <Activity size={34} />
              </div>
              <h3>Built for your strategy.</h3>
              <p>
                A dedicated home for your bots.
                <br />
                Your trading rules come next.
              </p>
              <ArrowUpRight className="feature-arrow" />
            </Link>
            <Link href="/app/analytics?demo=1" className="feature">
              <span className="feature-number">
                03 / UNDERSTAND THE DETAILS
              </span>
              <div className="feature-bars" aria-hidden="true">
                {[25, 48, 36, 66, 52, 83, 70, 100].map((v, i) => (
                  <i key={i} style={{ height: `${v}%` }} />
                ))}
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
            <Link href="/app/settings?demo=1" className="text-link">
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
          <a href="/app/dashboard?demo=1">
            Explore the platform <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} TwapTrade</span>
          <p>
            Trading involves risk. Illustrative data is for preview only and
            does not represent actual returns.
          </p>
        </div>
      </footer>
    </div>
  );
}
