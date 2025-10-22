import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";

// Expected CSV headers (case-insensitive):
// clientEmail, clientName, trackingNumber, origin, destination,
// shipDate, deliveryDate, weightKg, costCents
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const arrayBuffer = await (file as File).arrayBuffer();
    const csvText = Buffer.from(arrayBuffer).toString("utf-8");

    const parsed = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (v) => (typeof v === "string" ? v.trim() : v),
    });

    if (parsed.errors?.length) {
      return NextResponse.json(
        { error: "CSV parse error", details: parsed.errors.map((e) => e.message) },
        { status: 400 }
      );
    }

    const rows = parsed.data.filter((r) => Object.keys(r).length > 0);
    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV contained no data rows" }, { status: 400 });
    }

    // Map of clientEmail to clientId
    const emailToClientId = new Map<string, string>();

    // Collect unique emails
    const uniqueEmails = Array.from(
      new Set(
        rows
          .map((r) => (r.clientEmail || r.clientemail || r["ClientEmail"]))
          .filter((e): e is string => !!e)
      )
    );

    // Upsert/find clients
    for (const email of uniqueEmails) {
      const firstRow = rows.find(
        (r) => (r.clientEmail || r.clientemail || r["ClientEmail"]) === email
      );
      const name = firstRow?.clientName || firstRow?.clientname || firstRow?.["ClientName"];

      const client = await prisma.client.upsert({
        where: { email },
        update: { name: name || email },
        create: { email, name: name || email },
      });
      emailToClientId.set(email, client.id);
    }

    // Prepare shipments for bulk insert
    const toCreate: Array<{
      id?: string;
      clientId: string;
      trackingNumber?: string | null;
      origin?: string | null;
      destination?: string | null;
      shipDate?: Date | null;
      deliveryDate?: Date | null;
      weightKg?: any; // Decimal can be string
      costCents?: number | null;
    }> = [];

    for (const r of rows) {
      const email = r.clientEmail || r.clientemail || r["ClientEmail"];
      if (!email) continue;
      const clientId = emailToClientId.get(email);
      if (!clientId) continue;

      const parseDate = (value?: string) => {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      };

      const parseIntSafe = (value?: string) => {
        if (!value) return null;
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : null;
      };

      const weightStr = r.weightKg || r.weightkg || r["WeightKg"];
      const weight = weightStr ? String(Number(weightStr)) : null;

      toCreate.push({
        clientId,
        trackingNumber: r.trackingNumber || r["TrackingNumber"] || null,
        origin: r.origin || r["Origin"] || null,
        destination: r.destination || r["Destination"] || null,
        shipDate: parseDate(r.shipDate || r["ShipDate"]),
        deliveryDate: parseDate(r.deliveryDate || r["DeliveryDate"]),
        weightKg: weight,
        costCents: parseIntSafe(r.costCents || r["CostCents"]),
      });
    }

    if (toCreate.length === 0) {
      return NextResponse.json({ error: "No valid rows to import" }, { status: 400 });
    }

    const result = await prisma.shipment.createMany({ data: toCreate });

    return NextResponse.json({
      ok: true,
      imported: result.count,
      clients: emailToClientId.size,
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
