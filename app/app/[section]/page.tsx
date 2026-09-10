import { notFound } from "next/navigation";
import { requireChatGPTUser } from "../../chatgpt-auth";
import { Workspace } from "../../workspace";
export const dynamic = "force-dynamic";
const sections = [
  "dashboard",
  "wallet",
  "transactions",
  "bots",
  "analytics",
  "referrals",
  "settings",
];
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return { title: section.charAt(0).toUpperCase() + section.slice(1) };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { section } = await params;
  const query = await searchParams;
  if (!sections.includes(section)) notFound();
  return <WorkspacePage section={section} query={query} />;
}
async function WorkspacePage({
  section,
  query,
}: {
  section: string;
  query: Record<string, string>;
}) {
  const demo = query.demo === "1";
  const signInQuery = new URLSearchParams(
    Object.entries(query).filter(([k]) => ["entry", "ref"].includes(k)),
  );
  signInQuery.set("entry", "1");
  const suffix = signInQuery.toString();
  const user = demo
    ? null
    : await requireChatGPTUser(`/app/${section}${suffix ? `?${suffix}` : ""}`);
  return (
    <Workspace
      section={section}
      demo={demo}
      user={
        user
          ? {
              name: user.fullName || user.email.split("@")[0],
              email: user.email,
            }
          : null
      }
      entry={query.entry === "1"}
      referral={query.ref || ""}
    />
  );
}
