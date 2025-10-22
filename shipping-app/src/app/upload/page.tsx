"use client";
import { useState } from "react";
import { Button, Heading, Flex, Text, Callout } from "@radix-ui/themes";
import { UploadIcon } from "@radix-ui/react-icons";

export default function UploadPage() {
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);

    const formData = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Upload failed");
      setMessage(`Imported ${json.imported} shipments for ${json.clients} clients.`);
      e.currentTarget.reset();
    } catch (err: any) {
      setError(err?.message || "Unexpected error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex direction="column" gap="4" py="5">
      <Heading size="7">Import Shipments</Heading>
      <Text color="gray" size="3">
        Upload a CSV file with headers: clientEmail, clientName, trackingNumber, origin,
        destination, shipDate, deliveryDate, weightKg, costCents.
      </Text>
      {message && (
        <Callout.Root color="green">
          <Callout.Text>{message}</Callout.Text>
        </Callout.Root>
      )}
      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      <form onSubmit={onSubmit} encType="multipart/form-data">
        <input name="file" type="file" accept=".csv,text/csv" required />
        <div style={{ height: 8 }} />
        <Button type="submit" disabled={busy}>
          <UploadIcon /> {busy ? "Uploading..." : "Upload CSV"}
        </Button>
      </form>
    </Flex>
  );
}
