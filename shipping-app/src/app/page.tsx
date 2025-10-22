"use client";
import Link from "next/link";
import { Heading, Flex, Button, Card, Inset, Text } from "@radix-ui/themes";
import { UploadIcon, FileTextIcon, BarChartIcon } from "@radix-ui/react-icons";

export default function Home() {
  return (
    <Flex direction="column" gap="5" py="5">
      <Heading size="8">Shipping Dashboard</Heading>
      <Text size="3" color="gray">
        Import weekly shipping activity CSVs, generate invoices, and view analytics.
      </Text>
      <Flex gap="4" wrap="wrap">
        <Card size="3" style={{ maxWidth: 360 }}>
          <Inset>
            <Heading size="5">Import Shipments</Heading>
          </Inset>
          <Flex align="center" justify="between" mt="3">
            <Text color="gray">Upload CSV and ingest shipments.</Text>
            <Button asChild>
              <Link href="/upload">
                <UploadIcon /> Upload
              </Link>
            </Button>
          </Flex>
        </Card>
        <Card size="3" style={{ maxWidth: 360 }}>
          <Inset>
            <Heading size="5">Invoices</Heading>
          </Inset>
          <Flex align="center" justify="between" mt="3">
            <Text color="gray">View and generate weekly invoices.</Text>
            <Button asChild>
              <Link href="/invoices">
                <FileTextIcon /> Invoices
              </Link>
            </Button>
          </Flex>
        </Card>
        <Card size="3" style={{ maxWidth: 360 }}>
          <Inset>
            <Heading size="5">Reports</Heading>
          </Inset>
          <Flex align="center" justify="between" mt="3">
            <Text color="gray">Charts and KPIs for your activity.</Text>
            <Button asChild>
              <Link href="/reports">
                <BarChartIcon /> Reports
              </Link>
            </Button>
          </Flex>
        </Card>
      </Flex>
    </Flex>
  );
}
