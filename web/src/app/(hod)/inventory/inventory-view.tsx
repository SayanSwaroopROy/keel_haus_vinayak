"use client";

import { useState } from "react";
import { cn } from "cn";
import { DummyBadge, Figure, QueryState } from "@/components/ledger";
import { ProjectSelect } from "@/components/project-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useInventory, useProjectLookup, useProjects } from "@/lib/api/hooks";
import { isMocked } from "@/lib/api/mode";
import { MOCK_PROJECTS } from "@/lib/api/mocks/fixtures";
import { formatQty } from "@/lib/format";

export function InventoryView() {
  const [projectId, setProjectId] = useState<string>("ALL");
  const projects = useProjects();
  const lookupProject = useProjectLookup();
  const query = useInventory(projectId);
  const projectOptions = isMocked("inventory.list") ? MOCK_PROJECTS : (projects.data ?? []);
  const rows = query.data ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectSelect projects={projectOptions} value={projectId} onChange={setProjectId} allowAll />
        {rows.some((row) => row.is_dummy) ? <DummyBadge>Stock levels are demo data</DummyBadge> : null}
      </div>
      <QueryState
        query={query}
        isEmpty={rows.length === 0}
        empty={{ title: "No stock records", description: "This project has no materials on record." }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              {projectId === "ALL" ? <TableHead className="hidden md:table-cell">Project</TableHead> : null}
              <TableHead className="hidden text-right sm:table-cell">Physical</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-normal">
                  <span className="font-medium">{row.material}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{row.uom}</span>
                </TableCell>
                {projectId === "ALL" ? (
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {lookupProject(row.project_id)?.code ?? "—"}
                  </TableCell>
                ) : null}
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatQty(row.physical)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatQty(row.reserved)}</TableCell>
                <TableCell className={cn("text-right font-medium", row.available <= 0 && "text-binding")}>
                  {row.available <= 0 ? "Out of stock" : <Figure value={formatQty(row.available)} unit={row.uom} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </QueryState>
    </>
  );
}
