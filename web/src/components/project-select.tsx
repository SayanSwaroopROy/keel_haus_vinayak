"use client";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Project } from "@/lib/api/schemas";

export function ProjectSelect({
  projects,
  value,
  onChange,
  allowAll,
  id,
}: {
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  id?: string;
}) {
  const items = [
    ...(allowAll ? [{ value: "ALL", label: "All projects" }] : []),
    ...projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` })),
  ];
  return (
    <Select items={items} value={value} onValueChange={(next) => typeof next === "string" && onChange(next)}>
      <SelectTrigger id={id} className="h-9 w-full sm:w-72" aria-label="Project">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
