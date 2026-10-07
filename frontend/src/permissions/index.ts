import type { Role } from '../services/warehouse';
export type Page = 'dashboard' | 'receiving' | 'issue' | 'inventory' | 'stock-count' | 'approval' | 'reports' | 'export' | 'settings';
const pages: Record<Role, Page[]> = {
  Head: ['dashboard', 'inventory', 'receiving', 'issue', 'stock-count', 'approval', 'reports', 'export', 'settings'],
  Admin: ['dashboard', 'inventory', 'receiving', 'issue', 'stock-count', 'approval', 'reports', 'settings'],
  Checker: ['dashboard', 'receiving', 'issue', 'settings'],
  Staff: ['dashboard', 'stock-count', 'settings'],
  'System Admin': ['settings'],
};
export const allowedPages = (role: Role) => pages[role];
export const canViewBalances = (role: Role) => role === 'Admin' || role === 'Head';
