"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { runAction } from "@/lib/run-action";

/**
 * Per-row pending state. A Set rather than a single id so two rows submitting
 * at once do not overwrite each other's spinner.
 */
export function useRowActions() {
  const router = useRouter();
  const [, start] = useTransition();
  const [pendingIds, setPendingIds] = useState(() => new Set<string>());

  const submit = useCallback(
    <T>(
      id: string,
      action: (data: FormData) => Promise<T>,
      data: FormData,
      success: string,
      onSuccess?: () => void,
      undo?: (value: T) => (() => void) | null,
    ) => {
      setPendingIds((prev) => new Set(prev).add(id));
      start(() => {
        void runAction(action, data, success, () => router.refresh(), undo)
          .then((ok) => {
            if (ok) onSuccess?.();
          })
          .finally(() =>
            setPendingIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            }),
          );
      });
    },
    [router],
  );

  return { pendingIds, submit };
}
