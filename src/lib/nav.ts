export const NAV_LINKS = [
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heat", label: "Calor" },
  { href: "/inbox", label: "Inbox" },
  { href: "/setup", label: "Setup" },
] as const;

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
