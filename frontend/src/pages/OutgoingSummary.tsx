import { useEffect, useState } from "react";
import { api } from "../services/api";
import "./stock-out.css";

type Summary = {
  totals: { count: number; pcs: number; production_count: number; production_pcs: number; transfer_count: number; transfer_pcs: number };
  items: { product: string; product_name: string; count: number; pcs: number; production_pcs: number; transfer_pcs: number }[];
};
export function OutgoingSummary({ warehouse }: { warehouse: string }) {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Summary>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(undefined); setError("");
    api<Summary>(`/workspace/stock-out-summary?${new URLSearchParams({ from, to, search })}`, warehouse)
      .then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [warehouse, from, to, search]);
  return <section className="stock-out-workspace" aria-label="Ringkasan material keluar">
    <article className="inspection-card"><h2>Ringkasan material keluar / {warehouse}</h2>
      <p>Total server untuk seluruh transaksi yang cocok dalam periode waktu pengambilan (UTC), termasuk tanggal akhir. Bukan total dari 200 riwayat terbaru.</p>
      <div className="stock-out-fields">
        <label>Dari tanggal<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>Sampai tanggal<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label>Cari pengambil / SKU / nama / keperluan<input type="search" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} /></label>
      </div>
      {error ? <p role="alert">{error}</p> : !data ? <p role="status">Memuat ringkasan...</p> : <>
        <h3>{data.totals.pcs} PCS / {data.totals.count} transaksi</h3>
        <p>Produksi: {data.totals.production_pcs} PCS / {data.totals.production_count} transaksi</p>
        <p>Transfer: {data.totals.transfer_pcs} PCS / {data.totals.transfer_count} transaksi</p>
        <p>Maksimal 200 kelompok SKU / nama terbesar; total di atas mencakup semua hasil periode dan pencarian.</p>
        <div className="stock-out-table"><table><thead><tr><th>SKU / nama</th><th>Transaksi</th><th>Produksi PCS</th><th>Transfer PCS</th><th>Total PCS</th></tr></thead><tbody>
          {data.items.map(item => <tr key={JSON.stringify([item.product, item.product_name])}><td>{item.product} / {item.product_name}</td><td>{item.count}</td><td>{item.production_pcs}</td><td>{item.transfer_pcs}</td><td>{item.pcs}</td></tr>)}
        </tbody></table></div>
        {!data.items.length && <p>Belum ada material keluar pada periode ini.</p>}
      </>}
    </article>
  </section>;
}