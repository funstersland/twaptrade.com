import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/server/auth";
import { AdminPanel } from "../../admin-panel";
export const dynamic = "force-dynamic";
const sections = [
  "overview",
  "users",
  "bots",
  "deployments",
  "transactions",
  "profit-loss",
  "holdings",
  "referrals",
  "audit",
  "settings",
  "security",
];
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  return { title: `Administration · ${(await params).section}` };
}
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  const user = await getUser();
  if (!user || user.status !== "active") redirect("/login");
  if (!["owner", "admin"].includes(user.role)) redirect("/app/dashboard");
  return <AdminPanel section={section} />;
}
