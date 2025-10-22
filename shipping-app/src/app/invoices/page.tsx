import { prisma } from "@/lib/prisma";
import { formatCentsUSD } from "@/lib/currency";
import { Heading, Flex, Button, Table, Badge } from "@radix-ui/themes";

type InvoiceWithClientAndCount = Awaited<ReturnType<typeof prisma.invoice.findMany>>[number] & {
  client: { name: string };
  _count: { shipments: number };
};

export default async function InvoicesPage() {
  const invoices: InvoiceWithClientAndCount[] = await prisma.invoice.findMany({
    orderBy: { createdAt: "desc" },
    include: { client: true, _count: { select: { shipments: true } } },
  });

  async function generate() {
    "use server";
    const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    await fetch(`${base}/api/invoices/generate`, {
      method: "POST",
      cache: "no-store",
    });
  }

  return (
    <Flex direction="column" gap="4" py="5">
      <Heading size="7">Invoices</Heading>
      <form action={generate}>
        <Button type="submit">Generate weekly invoices</Button>
      </form>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Period</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Shipments</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell align="right">Total</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {invoices.map((inv: InvoiceWithClientAndCount) => (
            <Table.Row key={inv.id}>
              <Table.Cell>{inv.client.name}</Table.Cell>
              <Table.Cell>
                {new Date(inv.periodStart).toLocaleDateString()} — {new Date(inv.periodEnd).toLocaleDateString()}
              </Table.Cell>
              <Table.Cell>{inv._count.shipments}</Table.Cell>
              <Table.Cell>
                <Badge color={inv.status === "PAID" ? "green" : inv.status === "SENT" ? "blue" : "gray"}>
                  {inv.status}
                </Badge>
              </Table.Cell>
              <Table.Cell align="right">{formatCentsUSD(inv.totalCents)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Flex>
  );
}
