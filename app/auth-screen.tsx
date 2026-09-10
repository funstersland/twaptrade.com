"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Check,
  ShieldCheck,
} from "lucide-react";
import { Logo, Chart } from "./twap-ui";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
export function AuthScreen({
  mode,
  referral,
  signInPath,
}: {
  mode: string;
  referral: string;
  signInPath: string;
}) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const signup = mode === "signup",
    forgot = mode === "forgot-password",
    reset = mode === "reset-password";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData(e.currentTarget);
      const password = String(form.get("password") || "");
      if (reset && password !== form.get("confirmPassword")) {
        setMessage("Your passwords don’t match. Please try again.");
        return;
      }
      const res = await fetch("/api/email-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          email: form.get("email"),
          password,
          name: form.get("name"),
          referral,
        }),
      });
      const data = (await res.json()) as { message?: string };
      setMessage(data.message || "Please try again.");
    } catch {
      setMessage("We couldn’t connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Logo />
        <div className="auth-story-center">
          <span className="eyebrow">A MORE CONSIDERED WAY TO TRADE</span>
          <h1>
            Keep your edge.
            <br />
            <span className="accent-text">Find your calm.</span>
          </h1>
          <p>A clear head starts with a clear workspace.</p>
          <div className="auth-graph">
            <Chart />
            <span className="auth-graph-label">YOUR NEXT CHAPTER ↗</span>
          </div>
          <div className="auth-caption">
            <span>01 — PERSPECTIVE</span>
            <span>Always in motion.</span>
          </div>
        </div>
        <span className="auth-copyright">
          © {new Date().getFullYear()} TwapTrade
        </span>
      </aside>
      <section className="auth-main">
        <div className="auth-top">
          <Link href="/" className="text-link">
            <ArrowLeft size={16} /> Back to home
          </Link>
          <span>
            {signup ? "Already have an account?" : "New to TwapTrade?"}{" "}
            <Link href={signup ? "/login" : "/signup"}>
              {signup ? "Log in" : "Sign up"} <ArrowUpRight size={14} />
            </Link>
          </span>
        </div>
        <div className="auth-form-wrap">
          {(forgot || reset) && (
            <div className="auth-symbol">
              <LockKeyhole size={25} />
            </div>
          )}
          <span className="eyebrow">
            {signup
              ? "YOUR NEXT CHAPTER"
              : forgot || reset
                ? "LET’S GET YOU BACK IN"
                : "GOOD TO SEE YOU AGAIN"}
          </span>
          <h1>
            {signup
              ? "Make your next move."
              : forgot
                ? "Forgot your password?"
                : reset
                  ? "A fresh start."
                  : "Welcome back."}
          </h1>
          <p>
            {signup
              ? "A little clarity. A lot of possibility. Your workspace awaits."
              : forgot
                ? "Enter your account email to request a reset link."
                : reset
                  ? "Choose a strong new password for your account."
                  : "Your strategies, your portfolio, your perspective."}
          </p>
          {referral && (
            <div className="info-banner">
              <Check size={16} /> You’ve been invited. Your referral will be
              linked when you join.
            </div>
          )}
          {!forgot && !reset && (
            <>
              <a href={signInPath} target="_top" className="button sso-button">
                <ShieldCheck size={18} /> Continue with ChatGPT{" "}
                <ArrowUpRight size={16} />
              </a>
              <div className="auth-divider">
                <span />
                or continue with email
                <span />
              </div>
            </>
          )}
          <div className="auth-availability">
            Email accounts{" "}
            {forgot || reset ? "and password recovery are" : "are"} awaiting the
            launch connection.
            {!forgot &&
              !reset &&
              " You can use ChatGPT to create your workspace now."}
          </div>
          <form onSubmit={submit} className="auth-form">
            {signup && (
              <label>
                Full name
                <Input
                  name="name"
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  maxLength={80}
                />
              </label>
            )}
            {!reset && (
              <label>
                Email address
                <Input
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
            )}
            {!forgot && (
              <label>
                <span className="row-between">
                  {reset ? "New password" : "Password"}
                  {!signup && !reset && (
                    <Link href="/forgot-password">Forgot password?</Link>
                  )}
                </span>
                <div className="password-input">
                  <Input
                    name="password"
                    type={show ? "text" : "password"}
                    placeholder={
                      signup || reset
                        ? "At least 12 characters"
                        : "Enter your password"
                    }
                    minLength={signup || reset ? 12 : 1}
                    required
                    autoComplete={
                      signup || reset ? "new-password" : "current-password"
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
            )}
            {reset && (
              <label>
                Confirm new password
                <Input
                  name="confirmPassword"
                  type={show ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  minLength={12}
                />
              </label>
            )}
            {signup && (
              <div className="signup-note">
                <ShieldCheck size={15} />
                <span>
                  Account access and referral tracking are available with
                  ChatGPT.
                </span>
              </div>
            )}
            {message && (
              <p role="alert" className="form-message">
                {message}
              </p>
            )}
            <button className="button full-width" disabled={busy}>
              {busy
                ? "Please wait…"
                : signup
                  ? "Create account"
                  : forgot
                    ? "Send reset link"
                    : reset
                      ? "Update password"
                      : "Log in"}
              {!busy && <ArrowUpRight size={18} />}
            </button>
          </form>
          <div className="auth-demo">
            Want a look around first?{" "}
            <Link href="/app/dashboard?demo=1&entry=1">
              Explore the demo <ArrowRightInline />
            </Link>
          </div>
          {forgot && (
            <Link href="/login" className="back-login">
              <ArrowLeft size={15} /> Back to log in
            </Link>
          )}
        </div>
        <div className="auth-bottom">
          <LockKeyhole size={13} /> Your workspace, safely in your hands.
        </div>
      </section>
    </main>
  );
}
function ArrowRightInline() {
  return <ArrowUpRight size={13} />;
}
