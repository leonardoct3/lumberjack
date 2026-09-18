"use client";

import type { JSX } from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HeatGroup } from "@/components/heat/heat-board";

const ALL = "__all__";

function label(group: HeatGroup): string {
  return group.paused ? `${group.name} (pausado)` : group.name;
}

export function HeatFilter(props: {
  janela: 1 | 3 | 7;
  grupo: string;
  groups: HeatGroup[];
}): JSX.Element {
  const { janela, grupo, groups } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const selected = groups.find((group) => group.id === grupo);

  function go(value: string) {
    const query = new URLSearchParams();
    if (janela) query.set("janela", String(janela));
    if (value !== ALL) query.set("grupo", value);
    const search = query.toString();
    start(() => router.push(search ? `/heat?${search}` : "/heat"));
  }

  return (
    <div className="min-w-0 md:min-w-56">
      <p
        id="heat-group-label"
        className="mb-2.5 flex items-center gap-2 text-xs font-medium text-muted-foreground"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        Grupo monitorado
      </p>
      <Select value={grupo || ALL} onValueChange={go} disabled={pending}>
        <SelectTrigger
          aria-labelledby="heat-group-label"
          aria-busy={pending || undefined}
          className="w-full md:w-56"
        >
          <SelectValue>{selected ? label(selected) : "Todos os grupos"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos os grupos</SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {label(group)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
