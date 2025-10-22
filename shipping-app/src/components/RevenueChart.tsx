"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export type RevenuePoint = { name: string; total: number };

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <XAxis dataKey="name" hide={data.length > 8} />
          <YAxis />
          <Tooltip />
          <Bar dataKey="total" fill="#0ea5e9" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
