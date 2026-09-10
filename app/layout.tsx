import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./twap-ui";
export const metadata: Metadata = {
  referrer: "no-referrer",
  title: {
    default: "TwapTrade — Your strategy. Always in motion.",
    template: "%s · TwapTrade",
  },
  description:
    "A considered way to automate your trading. One clear view of your bots, assets, and every move.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "TwapTrade — Your strategy. Always in motion.",
    description:
      "A considered trading workspace for your portfolio, bots, and every move.",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-accent="mint"
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
