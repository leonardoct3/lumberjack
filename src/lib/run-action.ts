"use client";

import { toast } from "sonner";
import { FAIL_TOAST } from "@/lib/toast-copy";

export async function runAction(
  action: (data: FormData) => Promise<void>,
  data: FormData,
  success: string,
  refresh: () => void,
): Promise<boolean> {
  try {
    await action(data);
    toast.success(success);
    refresh();
    return true;
  } catch {
    toast.error(FAIL_TOAST);
    return false;
  }
}
