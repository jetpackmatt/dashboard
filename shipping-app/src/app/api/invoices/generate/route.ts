import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { startOfWeek, endOfWeek } from "date-fns";

export async function POST() {
  try {
    // Fetch all shipments that are not yet invoiced and have a shipDate
    const shipments = await prisma.shipment.findMany({
      where: { invoiceId: null, shipDate: { not: null } },
      select: {
        id: true,
        clientId: true,
        shipDate: true,
        costCents: true,
      },
      orderBy: { shipDate: "asc" },
    });

    if (shipments.length === 0) {
      return NextResponse.json({ ok: true, created: 0 });
    }

    type GroupKey = string;
    const groups = new Map<GroupKey, { clientId: string; periodStart: Date; periodEnd: Date; shipmentIds: string[]; subtotalCents: number }>();

    for (const s of shipments) {
      const sd = s.shipDate as Date; // not null by where clause
      const periodStart = startOfWeek(sd, { weekStartsOn: 1 });
      const periodEnd = endOfWeek(sd, { weekStartsOn: 1 });
      const key = `${s.clientId}:${periodStart.toISOString()}`;
      const entry = groups.get(key) || {
        clientId: s.clientId,
        periodStart,
        periodEnd,
        shipmentIds: [] as string[],
        subtotalCents: 0,
      };
      entry.shipmentIds.push(s.id);
      entry.subtotalCents += s.costCents ?? 0;
      groups.set(key, entry);
    }

    let created = 0;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const { clientId, periodStart, periodEnd, shipmentIds, subtotalCents } of groups.values()) {
        // If an invoice already exists for this client+period, skip (idempotency)
        const existing = await tx.invoice.findFirst({
          where: { clientId, periodStart, periodEnd },
          select: { id: true },
        });
        if (existing) {
          // Ensure these shipments are linked if not already
          await tx.shipment.updateMany({
            where: { id: { in: shipmentIds }, invoiceId: null },
            data: { invoiceId: existing.id },
          });
          continue;
        }

        const taxCents = 0;
        const totalCents = subtotalCents + taxCents;

        const invoice = await tx.invoice.create({
          data: { clientId, periodStart, periodEnd, subtotalCents, taxCents, totalCents },
          select: { id: true },
        });

        await tx.shipment.updateMany({
          where: { id: { in: shipmentIds } },
          data: { invoiceId: invoice.id },
        });

        created += 1;
      }
    });

    return NextResponse.json({ ok: true, created });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
