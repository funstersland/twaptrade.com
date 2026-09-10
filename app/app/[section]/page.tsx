import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/server/auth";
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
  const user = await getUser();
  if (!user || user.status !== "active") redirect("/login");
  return <Workspace section={section} entry={query.entry === "1"} />;
}
