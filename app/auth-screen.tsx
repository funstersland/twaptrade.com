"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Logo } from "./twap-ui";
import { Input } from "@/components/ui/input";
export function AuthScreen({
  mode,
  referral = "",
  resetToken = "",
}: {
  mode: string;
  referral?: string;
  resetToken?: string;
}) {
  const [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false);
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
      if (reset && password !== form.get("confirmPassword"))
        throw new Error("Your passwords don’t match.");
      const payload: Record<string, unknown> = { action: mode };
      if (!reset) payload.email = form.get("email");
      if (!forgot) payload.password = password;
      if (signup) {
        payload.name = form.get("name");
        payload.referral = referral;
      }
      if (reset) payload.token = resetToken;
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        redirect?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error || "Please try again.");
      if (data.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      setMessage(data.message || "Request completed.");
      setDone(reset || forgot);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "We couldn’t connect. Please try again.",
      );
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
          <p>Your strategies, together in one workspace.</p>
          <div className="auth-monogram" aria-hidden="true">
            <svg viewBox="0 0 320 190">
              <path
                d="M20 40H290L235 100H145L70 180H0L115 40M205 117H280L220 180H145Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <div className="auth-caption">
            <span>TWAPTRADE / WORKSPACE</span>
            <span>Built for clarity.</span>
          </div>
        </div>
        <span className="auth-copyright">
          © {new Date().getFullYear()} TwapTrade
        </span>
      </aside>
      <section className="auth-main">
        <div className="auth-top">
          <Link href="/" className="text-link">
            <ArrowLeft size={16} />
            Back to home
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
                ? "ACCOUNT RECOVERY"
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
              ? "Create your account and make the workspace yours."
              : forgot
                ? "Request help recovering access to your account."
                : reset
                  ? "Choose a new password for your account."
                  : "Your workspace is right where you left it."}
          </p>
          {signup && referral && (
            <div className="info-banner">Referral code: {referral}</div>
          )}
          <form onSubmit={submit} className="auth-form">
            {!done && (
              <>
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
                      placeholder="Enter your email address"
                      autoComplete="username"
                      required
                      maxLength={254}
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
                        maxLength={128}
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
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                )}
              </>
            )}
            {message && (
              <p role="alert" className="form-message">
                {message}
              </p>
            )}
            {!done && (
              <button
                className="button auth-submit"
                disabled={busy || (reset && !resetToken)}
              >
                {busy
                  ? "Please wait…"
                  : signup
                    ? "Create account"
                    : forgot
                      ? "Request recovery"
                      : reset
                        ? "Update password"
                        : "Log in"}
                <ArrowUpRight size={18} />
              </button>
            )}
            {reset && !resetToken && (
              <p className="form-message">
                Open the secure reset link provided by your administrator.
              </p>
            )}
            {done && (
              <Link href="/login" className="button">
                Back to login
                <ArrowUpRight size={16} />
              </Link>
            )}
          </form>
        </div>
        <div className="auth-bottom">
          <ShieldCheck size={14} /> Private access. Your workspace, protected.
        </div>
      </section>
    </main>
  );
}
