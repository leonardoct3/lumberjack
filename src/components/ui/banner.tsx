export function Banner({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "accent" | "danger";
  children: React.ReactNode;
}) {
  const extra = tone === "muted" ? "" : ` banner--${tone}`;
  return <p className={`banner${extra}`}>{children}</p>;
}
