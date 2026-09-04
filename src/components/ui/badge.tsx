export function Badge({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "accent" | "danger";
  children: React.ReactNode;
}) {
  const extra = tone === "muted" ? "" : ` badge--${tone}`;
  return <span className={`badge${extra}`}>{children}</span>;
}
