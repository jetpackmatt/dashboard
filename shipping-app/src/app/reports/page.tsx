import { prisma } from "@/lib/prisma";
import { Heading, Flex, Text, Card } from "@radix-ui/themes";
import { RevenueChart } from "@/components/RevenueChart";

export default async function ReportsPage() {
  // Aggregate totals by week (last 8 weeks)
  const data = await prisma.invoice.groupBy({
    by: ["periodStart"],
    _sum: { totalCents: true },
    orderBy: { periodStart: "asc" },
    where: {
      periodStart: {
        gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7 * 12),
      },
    },
  });

  const chartData = data.map((d) => ({
    name: new Date(d.periodStart).toLocaleDateString(),
    total: (d._sum.totalCents ?? 0) / 100,
  }));

  const totalRevenue = chartData.reduce((acc, d) => acc + d.total, 0);

  return (
    <Flex direction="column" gap="5" py="5">
      <Heading size="7">Reports</Heading>
      <Text color="gray">Last 12 weeks of revenue by invoice period.</Text>
      <Card>
        <RevenueChart data={chartData} />
      </Card>
      <Text size="4">Total revenue: ${totalRevenue.toFixed(2)}</Text>
    </Flex>
  );
}
