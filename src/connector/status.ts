import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type WaStatus = {
  state: "connected" | "qr" | "disconnected";
  updatedAt: string;
  detail?: string;
};

export function readWaStatus(path: string): WaStatus {
  if (!existsSync(path)) {
    return {
      state: "disconnected",
      updatedAt: new Date(0).toISOString(),
      detail: "missing-session",
    };
  }
  return JSON.parse(readFileSync(path, "utf8")) as WaStatus;
}

export function writeWaStatus(path: string, status: WaStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(status));
}
