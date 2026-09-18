export default function Loading() {
  return (
    <main className="space-y-7" aria-busy="true" aria-label="Carregando painel">
      <div className="h-28 animate-pulse rounded-[var(--radius)] bg-muted/60" />
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius)] bg-border">
        <div className="h-24 animate-pulse bg-card" />
        <div className="h-24 animate-pulse bg-card" />
        <div className="h-24 animate-pulse bg-card" />
      </div>
    </main>
  );
}
