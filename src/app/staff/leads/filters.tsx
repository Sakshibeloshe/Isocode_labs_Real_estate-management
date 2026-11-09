"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui";
import { LEAD_STATUS, SOURCE } from "@/lib/labels";

export default function Filters({ view }: { view: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("view", view);
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`/staff/leads?${next.toString()}`);
  };

  // search as you type, debounced
  useEffect(() => {
    const h = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set("q", q);
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
      <label className="relative col-span-3 sm:col-span-1">
        <span className="sr-only">Search leads</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or lead ID" className="pl-9" />
      </label>
      <Select aria-label="Source" value={sp.get("source") ?? ""} onChange={(e) => set("source", e.target.value)}>
        <option value="">All sources</option>
        {Object.entries(SOURCE).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <Select aria-label="Project" value={sp.get("project") ?? ""} onChange={(e) => set("project", e.target.value)}>
        <option value="">Both projects</option>
        <option value="P1">Project 1</option>
        <option value="P2">Project 2</option>
      </Select>
      <Select aria-label="Status" value={sp.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">Any status</option>
        {Object.entries(LEAD_STATUS).map(([k, [v]]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
    </div>
  );
}
