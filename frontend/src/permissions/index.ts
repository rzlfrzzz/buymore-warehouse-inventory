import type { Role } from "../services/warehouse";
export type Page =
  | "dashboard"
  | "receiving"
  | "issue"
  | "inventory"
  | "stock-count"
  | "approval"
  | "reports"
  | "export"
  | "settings";
const pages: Record<Role, Page[]> = {
  Admin: [
    "dashboard",
    "inventory",
    "receiving",
    "issue",
    "stock-count",
    "approval",
    "reports",
    "export",
    "settings",
  ],
  User: ["stock-count"],
};
export const allowedPages = (role: Role) => pages[role];
export const canViewBalances = (role: Role) => role === "Admin";
