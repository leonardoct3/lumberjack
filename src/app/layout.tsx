import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Lumberjack",
  title: {
    default: "Lumberjack",
    template: "%s · Lumberjack",
  },
  description: "Inteligência operacional para compra de ingressos.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lumberjack",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#5f1e82",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body className="font-sans">
        <AppShell>{children}</AppShell>
        <Toaster richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}
