import { Landing } from "./twap-ui";

// Keep the public home response separate from prerendered workspace redirects.
export const dynamic = "force-dynamic";

export default function Home() {
  return <Landing />;
}
