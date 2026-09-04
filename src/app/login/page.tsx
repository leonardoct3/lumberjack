import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Activity, ArrowRight, LockKeyhole, Radio, ShieldCheck } from "lucide-react";
import { COOKIE, makeSessionToken } from "@/auth/cookie";
import { BrandMark } from "@/components/shell/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = {
  title: "Acesso",
};

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const secret = process.env.AUTH_PASSWORD ?? "";
  if (!password || !secret || password !== secret) {
    return;
  }

  const jar = await cookies();
  jar.set(COOKIE, makeSessionToken(password, secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/");
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4 md:p-8">
      <Card className="grid min-h-[560px] w-full max-w-[940px] gap-0 overflow-hidden border-border/90 p-0 shadow-[0_40px_120px_rgba(0,0,0,0.45)] md:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden border-r border-border bg-[#111015] p-10 md:flex md:flex-col">
          <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(193,107,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(193,107,255,0.05)_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className="relative z-10">
            <BrandMark />
          </div>

          <div className="relative z-10 my-auto max-w-sm py-12">
            <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">
              Operação em tempo real
            </p>
            <div className="mt-5 text-4xl leading-[1.08] font-semibold tracking-[-0.05em] text-balance">
              Menos ruído.<br />Mais sinal.
            </div>
            <p className="mt-5 text-sm leading-6 text-muted-foreground">
              Acompanhe a pressão do mercado e tome decisões de compra com contexto.
            </p>

            <div className="mt-9 rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs font-medium text-primary">
                  <Radio className="size-3.5" /> Signal desk
                </span>
                <span className="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">Live</span>
              </div>
              <div className="mt-5 flex h-20 items-end gap-2" aria-hidden="true">
                {[26, 44, 33, 62, 48, 76, 55, 88, 70, 96, 80, 66].map((height, index) => (
                  <span key={index} className="flex-1 rounded-t-sm bg-primary/20" style={{ height: `${height}%` }}>
                    <span className="block w-full rounded-t-sm bg-primary" style={{ height: `${Math.max(14, height - 38)}%` }} />
                  </span>
                ))}
              </div>
            </div>
          </div>

          <p className="relative z-10 flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            Acesso protegido ao ambiente local
          </p>
        </section>

        <section className="flex flex-col justify-center bg-card p-6 md:p-10 lg:p-12">
          <BrandMark className="mb-14 md:hidden" />
          <div className="mx-auto w-full max-w-sm">
            <span className="grid size-11 place-items-center rounded-xl border border-primary/20 bg-primary/8 text-primary">
              <LockKeyhole className="size-5" />
            </span>
            <p className="mt-7 font-mono text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">Acesso restrito</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">Bem-vindo de volta</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Entre com a senha do operador para acessar o painel.
            </p>

            <form action={login} className="mt-8 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">Senha de acesso</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  placeholder="Digite sua senha"
                  className="h-11"
                />
              </div>
              <Button type="submit" size="lg" className="w-full">
                Entrar no painel
                <ArrowRight />
              </Button>
            </form>

            <div className="mt-8 flex items-start gap-3 border-t border-border/70 pt-6 text-xs leading-5 text-muted-foreground">
              <Activity className="mt-0.5 size-3.5 shrink-0 text-primary" />
              A sessão permanece ativa somente neste navegador.
            </div>
          </div>
        </section>
      </Card>
    </main>
  );
}
