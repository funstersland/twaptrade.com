import Link from "next/link";
import { Logo } from "./twap-ui";
export default function NotFound() {
  return (
    <main className="fallback-page">
      <Logo />
      <span className="eyebrow">404 · A SMALL DETOUR</span>
      <h1>Let’s get you back on track.</h1>
      <p>
        This page isn’t part of your workspace. Your next move is back home.
      </p>
      <Link href="/" className="button">
        Back to home
      </Link>
    </main>
  );
}
