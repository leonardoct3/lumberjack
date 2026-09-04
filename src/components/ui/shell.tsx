import { readWaStatus } from "@/connector/status";
import { Banner } from "./banner";
import { HideOnLogin } from "./hide-on-login";
import { sessionBanner } from "./session-banner";
import { ShellNav } from "./shell-nav";

export function Shell({ children }: { children: React.ReactNode }) {
  const status = readWaStatus(
    process.env.WA_STATUS_PATH ?? "./data/wa-status.json",
  );
  const banner = sessionBanner(status.state);
  return (
    <>
      <ShellNav />
      {banner ? (
        <HideOnLogin>
          <Banner tone={banner.tone}>{banner.text}</Banner>
        </HideOnLogin>
      ) : null}
      {children}
    </>
  );
}
