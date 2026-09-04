"use client";

import { toast } from "sonner";
import { FAIL_TOAST } from "@/lib/toast-copy";

export async function runAction(
  action: (data: FormData) => Promise<void>,
  data: FormData,
  success: string,
  refresh: () => void,
): Promise<void> {
  try {
    await action(data);
    toast.success(success);
    refresh();
  } catch {
    toast.error(FAIL_TOAST);
  }
}
