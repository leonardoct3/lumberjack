import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { dismissOrphan } from "@/catalog/dismiss-orphan";
import { prisma } from "@/db/client";
import { ingestRawMessage, type RawMessageInput } from "@/ingest/ingest";
import { refreshHeat } from "@/jobs/refresh-heat";

/**
 * Local-only board filler. Additive: every row is keyed by a `demo-` id so it
 * can run twice and never touches rows it did not create. Goes through
 * `ingestRawMessage` so classification, dedupe and signals come out coherent.
 */

const GROUPS = [
  { waId: "demo-g-sp", name: "Ingressos SP • Revenda" },
  { waId: "demo-g-rodeio", name: "Rodeios & Sertanejo BR" },
  { waId: "demo-g-reveillon", name: "Réveillon 2027 Ofertas" },
] as const;

const REVEILLON_BLAST = `🌞 RÉVEILLONS BÚZIOS E RJ CAPITAL
🔗 *Cupom desconto:* CODELIS
🌊 *RÉVEILLON AREIA BÚZIOS* 🌊 _27.12 a 02.01_ 📍 Clube Aretê - Búzios RJ 🍹 Open Bar Premium 🎟️ Garanta com *DESCONTO* abaixo: https://tinyurl.com/Areia2027
🐚 *A VILLA RÉVEILLON BÚZIOS* 🐚 🗓️ _29 a 31/12 + 02.01_ 🍹 Full Open Bar e dia 31 +Open Food! 🎟️ https://tinyurl.com/AVilla2027
🪩 31.12 • *RÉVEILLON SAL* 🪩 📍 RJ - Sociedade Hípica Brasileira 🍹🍝 All Inclusive 🎟️ https://www.sympla.com.br/evento/reveillon-sal/3543836?d=CODELIS`;

function hoursAgo(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

/** 23:00 UTC is 20:00 in São Paulo, a believable door time. */
function daysAhead(now: Date, days: number): Date {
  const date = new Date(now.getTime() + days * 86_400_000);
  return new Date(`${date.toISOString().slice(0, 10)}T23:00:00Z`);
}

type Msg = {
  id: string;
  group: (typeof GROUPS)[number]["waId"];
  senderWaId: string;
  senderName: string;
  admin?: boolean;
  hours: number;
  text: string;
};

function toInput(msg: Msg, now: Date): RawMessageInput {
  const group = GROUPS.find((g) => g.waId === msg.group)!;
  return {
    waMessageId: msg.id,
    groupWaId: group.waId,
    groupName: group.name,
    senderWaId: msg.senderWaId,
    senderName: msg.senderName,
    sentAt: hoursAgo(now, msg.hours),
    text: msg.text,
    senderIsGroupAdmin: msg.admin ?? false,
  };
}

async function ensureGroups(db: PrismaClient): Promise<void> {
  for (const group of GROUPS) {
    await db.group.upsert({
      where: { waId: group.waId },
      create: { waId: group.waId, name: group.name, listen: true },
      update: { name: group.name, listen: true },
    });
  }
}

async function ensureParty(
  db: PrismaClient,
  input: {
    name: string;
    aliases: string[];
    eventAt: Date;
    watchlistPosition: number | null;
    qualitativeScore?: number;
    lot?: { label: string; price: number; platform: "sympla" | "gandaya" };
  },
): Promise<string> {
  const existing = await db.party.findFirst({ where: { name: input.name } });
  if (existing) return existing.id;

  const party = await db.party.create({
    data: {
      name: input.name,
      aliases: input.aliases,
      eventAt: input.eventAt,
      status: "upcoming",
      watchlistPosition: input.watchlistPosition,
      qualitativeScore: input.qualitativeScore,
    },
  });

  if (input.lot) {
    await db.lot.create({
      data: {
        partyId: party.id,
        label: input.lot.label,
        openedAt: new Date(),
        officialPrice: input.lot.price,
        platform: input.lot.platform,
        url: "https://www.sympla.com.br/evento/demo",
      },
    });
  }

  return party.id;
}

async function main(): Promise<void> {
  const now = new Date();
  await ensureGroups(prisma);

  // Parties must exist before the pista messages land, because matchParty runs
  // at ingest time. Two carry a lot (watchlist), one is a heat-only stub.
  await ensureParty(prisma, {
    name: "Rodeio de Jaguariúna",
    aliases: ["jaguariuna", "superbull"],
    eventAt: daysAhead(now, 3),
    watchlistPosition: 1,
    qualitativeScore: 5,
    lot: { label: "Pista", price: 120, platform: "sympla" },
  });
  await ensureParty(prisma, {
    name: "Baile da Favorita",
    aliases: ["favorita"],
    eventAt: daysAhead(now, 17),
    watchlistPosition: 2,
    qualitativeScore: 4,
    lot: { label: "2º lote", price: 90, platform: "gandaya" },
  });
  await ensureParty(prisma, {
    name: "Sunset Beach",
    aliases: ["sunset"],
    eventAt: daysAhead(now, 11),
    watchlistPosition: null,
  });

  const messages: Msg[] = [
    // Admin promo that the rules read cleanly -> tidy candidate.
    {
      id: "demo-promo-onix",
      group: "demo-g-sp",
      senderWaId: "demo-s-lis",
      senderName: "Lis Promo",
      admin: true,
      hours: 5,
      text: "ONIX FESTIVAL\n1º lote R$ 180 24/10 https://www.sympla.com.br/evento/onix-festival",
    },
    // Multi-event blast, cross-posted: one junk candidate plus a reach badge.
    {
      id: "demo-promo-reveillon-1",
      group: "demo-g-reveillon",
      senderWaId: "demo-s-lis",
      senderName: "Lis Promo",
      admin: true,
      hours: 8,
      text: REVEILLON_BLAST,
    },
    {
      id: "demo-promo-reveillon-2",
      group: "demo-g-sp",
      senderWaId: "demo-s-lis",
      senderName: "Lis Promo",
      admin: true,
      hours: 8,
      text: REVEILLON_BLAST,
    },

    // Heat for Jaguariúna: many different people asking, few selling.
    { id: "demo-d1", group: "demo-g-rodeio", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 2, text: "procuro 2 pista jaguariuna pago acima" },
    { id: "demo-d2", group: "demo-g-rodeio", senderWaId: "demo-s-marina", senderName: "Marina", hours: 6, text: "alguem tem pista jaguariuna pra sabado?" },
    { id: "demo-d3", group: "demo-g-sp", senderWaId: "demo-s-rafa", senderName: "Rafa", hours: 9, text: "preciso de 1 pista superbull jaguariuna" },
    { id: "demo-d4", group: "demo-g-rodeio", senderWaId: "demo-s-camila", senderName: "Camila", hours: 20, text: "quero comprar pista jaguariuna, alguem?" },
    { id: "demo-d5", group: "demo-g-rodeio", senderWaId: "demo-s-teo", senderName: "Téo", hours: 40, text: "procuro jaguariuna" },
    // Phrasings the old lexicon dropped as ruído: buyers in their own words.
    { id: "demo-d9", group: "demo-g-rodeio", senderWaId: "demo-s-marina", senderName: "Marina", hours: 7, text: "compro 2 pista jaguariuna, pago acima" },
    { id: "demo-d10", group: "demo-g-sp", senderWaId: "demo-s-rafa", senderName: "Rafa", hours: 11, text: "quem tem pista da favorita?" },
    { id: "demo-d11", group: "demo-g-sp", senderWaId: "demo-s-camila", senderName: "Camila", hours: 19, text: "alguem ta vendendo pista favorita?" },
    { id: "demo-d12", group: "demo-g-sp", senderWaId: "demo-s-teo", senderName: "Téo", hours: 23, text: "busco 1 pista sunset" },
    { id: "demo-o1", group: "demo-g-rodeio", senderWaId: "demo-s-bruno", senderName: "Bruno", hours: 14, text: "vendo 1 pista jaguariuna transferivel" },

    // Favorita: balanced, so it should read liquid rather than scarce.
    { id: "demo-d6", group: "demo-g-sp", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 12, text: "procuro pista favorita" },
    { id: "demo-o2", group: "demo-g-sp", senderWaId: "demo-s-marina", senderName: "Marina", hours: 15, text: "vendo 2 pista favorita" },
    { id: "demo-o3", group: "demo-g-sp", senderWaId: "demo-s-rafa", senderName: "Rafa", hours: 30, text: "tenho extra favorita, chama" },
    { id: "demo-o4", group: "demo-g-sp", senderWaId: "demo-s-teo", senderName: "Téo", hours: 55, text: "revendo 1 favorita" },

    // Sunset: demand only, and the party has no lot -> heat only, no watchlist.
    { id: "demo-d7", group: "demo-g-sp", senderWaId: "demo-s-camila", senderName: "Camila", hours: 4, text: "procuro pista sunset" },
    { id: "demo-d8", group: "demo-g-sp", senderWaId: "demo-s-bruno", senderName: "Bruno", hours: 26, text: "alguem com sunset?" },

    // Same offer blasted to three groups: one orphan card, badge reads 3.
    { id: "demo-x1", group: "demo-g-sp", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 3, text: "Vendo 2 pista Tomorrowland Brasil 11/10 transferível" },
    { id: "demo-x2", group: "demo-g-rodeio", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 3, text: "🎟️ vendo 2 pista tomorrowland brasil 11/10 transferivel 🔥" },
    { id: "demo-x3", group: "demo-g-reveillon", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 3, text: "Vendo 2 pista Tomorrowland Brasil - 11/10 (transferível)!!" },

    // Orphans for parties that were never catalogued.
    { id: "demo-orf1", group: "demo-g-sp", senderWaId: "demo-s-marina", senderName: "Marina", hours: 7, text: "procuro pista do Lollapalooza 2027" },
    { id: "demo-orf2", group: "demo-g-reveillon", senderWaId: "demo-s-rafa", senderName: "Rafa", hours: 10, text: "alguem tem Réveillon Areia Búzios 27/12?" },
    { id: "demo-orf3", group: "demo-g-sp", senderWaId: "demo-s-camila", senderName: "Camila", hours: 16, text: "vendo 1 pista Afro Jazz 05/10 na faixa" },
    { id: "demo-orf4", group: "demo-g-rodeio", senderWaId: "demo-s-teo", senderName: "Téo", hours: 18, text: "procuro camarote Barretos 22/08" },
    { id: "demo-orf5", group: "demo-g-sp", senderWaId: "demo-s-bruno", senderName: "Bruno", hours: 22, text: "vendo 2 pista Dream Valley 14/11 transferível" },
    { id: "demo-orf6", group: "demo-g-sp", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 28, text: "preciso 3 pista Universo Paralello" },
    { id: "demo-orf7", group: "demo-g-reveillon", senderWaId: "demo-s-marina", senderName: "Marina", hours: 33, text: "tenho extra A Villa Réveillon 31/12" },
    { id: "demo-orf8", group: "demo-g-sp", senderWaId: "demo-s-rafa", senderName: "Rafa", hours: 44, text: "vendo pista Chá da Alice 10/10" },
    { id: "demo-orf9", group: "demo-g-sp", senderWaId: "demo-s-camila", senderName: "Camila", hours: 60, text: "procuro pista Anitta Ensaios" },

         // Noise, to show the classifier filtering rather than everything landing.
         { id: "demo-n1", group: "demo-g-sp", senderWaId: "demo-s-teo", senderName: "Téo", hours: 1, text: "bom dia galera" },
         { id: "demo-n2", group: "demo-g-rodeio", senderWaId: "demo-s-bruno", senderName: "Bruno", hours: 13, text: "alguem sabe que horas abre?" },

         // Promoter blasts from someone who does not administer the group: the
         // ad shape alone has to open the candidate.
         { id: "demo-ad1", group: "demo-g-sp", senderWaId: "demo-s-cassi", senderName: "Cassi Sem Taxa", hours: 4, text: "⚠️ *MEIO ADVOGADO* 🎟️ 25.09 VIRADA DE LOTE HOJE 23h59 SEM TAXA https://wa.me/5511998845595 Aluno R$255 Não aluno R$290" },
         // Guest list on a host we do not know: one mark, no way to buy.
         { id: "demo-ad2", group: "demo-g-sp", senderWaId: "demo-s-babi", senderName: "BabiGol - Promoter", hours: 6, text: "*MOTIRÔ* _coloque seu nome na lista VIP_ Quarta - Dia de Feira https://www.pensanoevento.com.br/nomenalista/108274/dia-de-feira" },

         // Mentions a ticket but states no side: these land in the drawer.
         { id: "demo-u1", group: "demo-g-sp", senderWaId: "demo-s-gui", senderName: "Guilherme", hours: 2, text: "2 pista jaguariuna aqui" },
         { id: "demo-u2", group: "demo-g-rodeio", senderWaId: "demo-s-marina", senderName: "Marina", hours: 9, text: "alguem sabe se a pista ja esgotou?" },
         { id: "demo-u3", group: "demo-g-sp", senderWaId: "demo-s-rafa", senderName: "Rafa", hours: 21, text: "camarote da favorita tava cheio ontem" },
  ];

  let created = 0;
  let collapsed = 0;
  for (const msg of messages) {
    const result = await ingestRawMessage(prisma, toInput(msg, now));
    if (result.created) created += 1;
    if (result.duplicateOfId) collapsed += 1;
  }

  // Pista senders stay "unknown" until classified, which skews the Setup stats.
  await prisma.sender.updateMany({
    where: { waId: { startsWith: "demo-s-" }, role: "unknown" },
    data: { role: "pista" },
  });

  // One dismissed orphan so the reversible list at the bottom has content.
  const toDismiss = await prisma.message.findFirst({
    where: { waMessageId: "demo-orf9", dismissedAt: null, signals: { none: {} } },
  });
  if (toDismiss) await dismissOrphan(prisma, toDismiss.id, now);

  const heat = await refreshHeat(prisma, now);

  console.log({
    created,
    collapsed,
    heat,
    signals: await prisma.signal.count(),
    pendingCandidates: await prisma.partyCandidate.count({
      where: { status: "pending" },
    }),
    orphans: await prisma.message.count({
      where: {
        class: { in: ["pista_oferta", "pista_procura"] },
        signals: { none: {} },
        duplicateOfId: null,
        dismissedAt: null,
      },
    }),
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
