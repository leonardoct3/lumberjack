import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, makeSessionToken } from "@/auth/cookie";

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
    <main>
      <form action={login}>
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
        />
        <button type="submit">Entrar</button>
      </form>
    </main>
  );
}
