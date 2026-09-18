"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-[60vh] place-items-center p-4">
      <section className="max-w-md space-y-4 text-center">
        <p className="font-mono text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">
          Falha temporária
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">
          Não foi possível carregar o painel
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Tente novamente. Se o problema continuar, confira o monitor e a conexão do
          banco.
        </p>
        <Button type="button" onClick={reset}>
          Tentar novamente
        </Button>
      </section>
    </main>
  );
}
