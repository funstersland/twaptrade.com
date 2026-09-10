"use client";
import Link from "next/link";
import { Logo } from "./twap-ui";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="fallback-page">
      <Logo />
      <h1>A brief pause.</h1>
      <p>We couldn’t load this part of your workspace. Please try again.</p>
      <button onClick={reset} className="button">
        Try again
      </button>
      <Link href="/" className="text-link">
        Back to home
      </Link>
    </main>
  );
}
