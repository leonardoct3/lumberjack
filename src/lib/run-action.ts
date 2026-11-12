"use client";

import { toast } from "sonner";
import { FAIL_TOAST, UNDO_LABEL } from "@/lib/toast-copy";

/**
 * `undo` reads what the action returned and, when there is something to take
 * back, gives the success toast a button that does it.
 */
export async function runAction<T>(
  action: (data: FormData) => Promise<T>,
  data: FormData,
  success: string,
  refresh: () => void,
  undo?: (value: T) => (() => void) | null,
): Promise<boolean> {
  try {
    const value = await action(data);
    const onUndo = undo?.(value);
    if (onUndo)
      toast.success(success, { action: { label: UNDO_LABEL, onClick: onUndo } });
    else toast.success(success);
    refresh();
    return true;
  } catch {
    toast.error(FAIL_TOAST);
    return false;
  }
}
