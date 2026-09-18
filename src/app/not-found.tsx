import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-4 text-center">
      <section className="space-y-4">
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">
          Registro não encontrado
        </h1>
        <p className="text-sm text-muted-foreground">
          Ele pode ter sido removido ou não existir mais.
        </p>
        <Button asChild>
          <Link href="/inbox">Voltar para a Inbox</Link>
        </Button>
      </section>
    </main>
  );
}
