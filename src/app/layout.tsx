import { GeistSans } from "geist/font/sans";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`dark ${GeistSans.variable}`}>
      <body className="font-sans">
        <AppShell>{children}</AppShell>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
