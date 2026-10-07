import { useState } from 'react';
import { seed, type State } from '../services/warehouse';
const KEY = 'buymore.demo.v1';
function read(): State { try { const raw = localStorage.getItem(KEY); if (raw) { const value = JSON.parse(raw); if (value.version === 1 && ['stocks', 'documents', 'audit', 'ledger'].every(k => Array.isArray(value[k]))) return value; } } catch { /* An unavailable or invalid local cache starts a fresh demo. */ } return seed(); }
export function useWarehouse() {
  const [state, setState] = useState<State>(read);
  const update = (next: State) => { localStorage.setItem(KEY, JSON.stringify(next)); setState(next); };
  return { state, update };
}
