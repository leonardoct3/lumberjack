import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeSessionToken } from "@/auth/cookie";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <main className="grid min-h-[80vh] place-items-center">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-2xl font-semibold">Lumberjack</h1>
        <form action={login} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full">
            Entrar
          </Button>
        </form>
      </Card>
    </main>
  );
}
