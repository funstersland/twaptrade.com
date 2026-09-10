import { notFound } from "next/navigation";
import { AuthScreen } from "../auth-screen";
const routes = ["login", "signup", "forgot-password", "reset-password"];
export async function generateMetadata({
  params,
}: {
  params: Promise<{ auth: string }>;
}) {
  const { auth } = await params;
  return {
    title:
      (
        {
          login: "Welcome back",
          signup: "Create your account",
          "forgot-password": "Recover your account",
          "reset-password": "Choose a new password",
        } as Record<string, string>
      )[auth] || "TwapTrade",
  };
}
export default async function AuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ auth: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { auth } = await params;
  if (!routes.includes(auth)) notFound();
  const query = await searchParams;
  const ref = /^TW-[A-F0-9]{12}$/.test(query.ref || "") ? query.ref : "";
  return (
    <AuthScreen mode={auth} referral={ref} resetToken={query.token || ""} />
  );
}
