import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeSessionToken } from "@/auth/cookie";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
    <main
      className="page"
      style={{ minHeight: "80vh", display: "grid", placeItems: "center" }}
    >
      <Card>
        <h1>Lumberjack</h1>
        <form action={login} className="stack">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
          <Button type="submit">Entrar</Button>
        </form>
      </Card>
    </main>
  );
}
