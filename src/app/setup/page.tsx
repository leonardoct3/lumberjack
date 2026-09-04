import {
  actionSetGroupListen,
  actionSetSenderRole,
} from "@/app/actions/setup";
import { readWaStatus } from "@/connector/status";
import { prisma } from "@/db/client";

const BANNER: Record<ReturnType<typeof readWaStatus>["state"], string> = {
  connected: "Conectado",
  qr: "QR pendente",
  disconnected: "WhatsApp desconectado",
};

export default async function SetupPage() {
  const statusPath = process.env.WA_STATUS_PATH ?? "./data/wa-status.json";
  const status = readWaStatus(statusPath);
  const [groups, senders] = await Promise.all([
    prisma.group.findMany({ orderBy: { name: "asc" } }),
    prisma.sender.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <main>
      <h1>Setup</h1>
      <p>{BANNER[status.state]}</p>

      <section>
        <h2>Grupos</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Ouvir</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td>{group.name}</td>
                <td>
                  <form action={actionSetGroupListen}>
                    <input type="hidden" name="id" value={group.id} />
                    <input
                      type="hidden"
                      name="listen"
                      value={group.listen ? "0" : "1"}
                    />
                    <button type="submit">
                      {group.listen ? "Ouvindo" : "Pausado"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Remetentes</h2>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Papel</th>
            </tr>
          </thead>
          <tbody>
            {senders.map((sender) => (
              <tr key={sender.id}>
                <td>{sender.name ?? sender.waId}</td>
                <td>
                  <form action={actionSetSenderRole}>
                    <input type="hidden" name="id" value={sender.id} />
                    <select name="role" defaultValue={sender.role}>
                      <option value="admin">admin</option>
                      <option value="pista">pista</option>
                      <option value="unknown">unknown</option>
                    </select>
                    <button type="submit">Salvar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
