import { api } from "./api";

export interface Overview {
  receiving: number;
  issue: number;
  counts: number;
}

export async function loadOverview(warehouse: string): Promise<Overview> {
  const [receiving, issue, counts] = await Promise.all([
    api<{ total: number }>(
      "/operations/documents?type=RECEIVING&page=1&pageSize=1",
      warehouse,
    ),
    api<{ total: number }>(
      "/operations/documents?type=ISSUE&page=1&pageSize=1",
      warehouse,
    ),
    api<unknown[]>("/counts", warehouse),
  ]);
  return {
    receiving: receiving.total,
    issue: issue.total,
    counts: counts.length,
  };
}
