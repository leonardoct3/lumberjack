import {
  actionSetGroupListen,
  actionSetSenderRole,
} from "@/app/actions/setup";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { sessionBanner } from "@/components/ui/session-banner";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";

export default async function SetupPage() {
  const statusPath = process.env.WA_STATUS_PATH ?? "./data/wa-status.json";
  const status = readWaStatus(statusPath);
  const banner = sessionBanner(status.state);
  const [groups, senders] = await Promise.all([
    prisma.group.findMany({ orderBy: { name: "asc" } }),
    prisma.sender.findMany({ orderBy: { name: "asc" } }),
  ]);

  const groupRows = groups.map((group) => ({
    id: group.id,
    cells: {
      name: (
        <>
          {group.name}{" "}
          <Badge>{group.listen ? "Ouvindo" : "Pausado"}</Badge>
        </>
      ),
      listen: (
        <form action={actionSetGroupListen}>
          <input type="hidden" name="id" value={group.id} />
          <input
            type="hidden"
            name="listen"
            value={group.listen ? "0" : "1"}
          />
          <Button type="submit" variant="ghost">
            {group.listen ? "Pausar" : "Ouvir"}
          </Button>
        </form>
      ),
    },
  }));

  const senderRows = senders.map((sender) => ({
    id: sender.id,
    cells: {
      name: sender.name ?? sender.waId,
      role: (
        <form action={actionSetSenderRole} className="row">
          <input type="hidden" name="id" value={sender.id} />
          <select name="role" defaultValue={sender.role}>
            <option value="admin">admin</option>
            <option value="pista">pista</option>
            <option value="unknown">unknown</option>
          </select>
          <Button type="submit" variant="ghost">
            Salvar
          </Button>
        </form>
      ),
    },
  }));

  return (
    <main className="page stack">
      <h1>Setup</h1>
      {banner ? (
        <Banner tone={banner.tone}>{banner.text}</Banner>
      ) : (
        <Badge>Conectado</Badge>
      )}

      <section className="stack">
        <h2>Grupos</h2>
        <DataTable
          columns={[
            { key: "name", header: "Nome" },
            { key: "listen", header: "Ouvir" },
          ]}
          rows={groupRows}
          empty={<p>Nenhum grupo</p>}
        />
      </section>

      <section className="stack">
        <h2>Remetentes</h2>
        <DataTable
          columns={[
            { key: "name", header: "Nome" },
            { key: "role", header: "Papel" },
          ]}
          rows={senderRows}
          empty={<p>Nenhum remetente</p>}
        />
      </section>
    </main>
  );
}
