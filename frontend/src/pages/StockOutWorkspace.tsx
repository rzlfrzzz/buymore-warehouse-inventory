import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import "./stock-out.css";

type Catalog = { products: {code: string; name: string; uom: string; uom_factor: number}[]; locations: {id: string}[]; batches: {product: string; batch: string}[]; balances: {product: string; location: string; batch: string; quantity: number}[] };
type History = { records: {id: string; product: string; product_name: string; quantity: number; unit: string; base_quantity: number; purpose: string; warehouse: string; location: string; destination_warehouse: string | null; destination_location: string | null; batch: string; taker: string; taken_at: string; recorded_at: string; recorder: string}[]; destinations: {warehouse: string; location: string}[] };
export function localInputTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}
export function displayStockOutTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "long"}).format(new Date(value));
}
export function StockOutWorkspace({warehouse, refresh, setBusy}: {warehouse: string; refresh: () => Promise<unknown>; setBusy: (busy: boolean) => void}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [history, setHistory] = useState<History>();
  const [form, setForm] = useState({product: "", location: "", batch: "", unit: "PCS", quantity: "", purpose: "PRODUCTION", destination: "", taker: "", takenAt: localInputTime()});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [posting, setPosting] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<{payload: string; key: string} | undefined>(undefined);
  async function load() {
    const [c,h] = await Promise.all([api<Catalog>("/workspace/catalog",warehouse), api<History>("/workspace/stock-outs",warehouse)]);
    setCatalog(c); setHistory(h);
  }
  useEffect(() => { let active = true; Promise.all([api<Catalog>("/workspace/catalog",warehouse), api<History>("/workspace/stock-outs",warehouse)]).then(([c,h]) => { if(active) {setCatalog(c);setHistory(h);} }).catch(e => {if(active) setError(e.message);}); return () => {active=false;}; }, [warehouse]);
  const product = catalog?.products.find(p => p.code === form.product);
  const factor = form.unit === "PCS" ? 1 : product?.uom_factor || 1;
  const update = (key: keyof typeof form, value: string) => setForm(old => ({...old, [key]: value}));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if(inFlight.current) return;
    inFlight.current=true; setPosting(true); setBusy(true); setError(""); setNotice("");
    try {
      const destination = history?.destinations.find(d => JSON.stringify([d.warehouse,d.location]) === form.destination);
      const input = {product: form.product, location: form.location, batch: form.batch, unit: form.unit, quantity: Number(form.quantity), purpose: form.purpose, taker: form.taker, takenAt: new Date(form.takenAt).toISOString(), ...(form.purpose === "TRANSFER" ? {destinationWarehouse: destination?.warehouse, destinationLocation: destination?.location} : {})};
      const payload = JSON.stringify(input);
      if(retry.current?.payload !== payload) retry.current={payload,key:crypto.randomUUID()};
      await api("/workspace/stock-outs",warehouse,input,retry.current!.key);
      retry.current=undefined;
      setForm(old => ({...old,quantity:"",taker:"",takenAt:localInputTime()}));
      setNotice("Stock Out tersimpan. Stok resmi telah diperbarui.");
      try { await Promise.all([load(),refresh()]); } catch { setError("Tersimpan, tetapi pemuatan ulang gagal. Muat ulang halaman; jangan kirim ulang transaksi."); }
    } catch(e) {setError((e as Error).message);} finally {inFlight.current=false;setPosting(false);setBusy(false);}
  }
  return <section className="stock-out-workspace">
    <article className="inspection-card"><h2>Stock Out</h2><p>User dan Admin dapat mencatat. Produksi mengurangi stok; transfer memerlukan keanggotaan di kedua gudang.</p>
    {error && <p role="alert" className="inspection-error">{error}</p>}{notice && <p role="status" className="inspection-notice">{notice}</p>}
    <form onSubmit={submit}><fieldset disabled={posting || !catalog || !history} className="stock-out-fields">
      <label>Cari material SKU / nama<input type="search" value={materialSearch} onChange={e => setMaterialSearch(e.target.value)} /></label>
      <label>SKU<select required value={form.product} onChange={e => setForm(old => ({...old,product:e.target.value,batch:"",unit:"PCS"}))}><option value="">Pilih SKU</option>{catalog?.products.filter(p => p.code === form.product || `${p.code} ${p.name}`.toLowerCase().includes(materialSearch.toLowerCase())).map(p => <option key={p.code} value={p.code}>{p.code} / {p.name}</option>)}</select></label>
      <label>Nama barang<input readOnly value={product?.name || ""}/></label>
      <label>Lokasi sumber<select required value={form.location} onChange={e => update("location",e.target.value)}><option value="">Pilih lokasi</option>{catalog?.locations.map(l => <option key={l.id}>{l.id}</option>)}</select></label>
      <label>Batch<select value={form.batch} onChange={e => update("batch",e.target.value)}><option value="">Tanpa batch</option>{catalog?.batches.filter(b => b.product===form.product && b.batch).map(b => <option key={b.batch}>{b.batch}</option>)}</select></label>
      <label>Satuan<select value={form.unit} onChange={e => update("unit",e.target.value)}><option>PCS</option>{product && product.uom!=="PCS" && <option>{product.uom}</option>}</select></label>
      <label>Jumlah diambil<input required type="number" min="1" max="2147483647" step="1" value={form.quantity} onChange={e => update("quantity",e.target.value)}/></label>
      <p>Konversi: 1 {form.unit} = {factor} PCS. Total: {Number(form.quantity)*factor} PCS. Stok tersedia diperiksa server, tidak termasuk reservasi.</p>
      <label>Keperluan<select value={form.purpose} onChange={e => update("purpose",e.target.value)}><option value="PRODUCTION">Produksi</option><option value="TRANSFER">Transfer gudang</option></select></label>
      {form.purpose==="TRANSFER" && <label>Gudang / lokasi tujuan<select required value={form.destination} onChange={e => update("destination",e.target.value)}><option value="">Pilih tujuan berizin</option>{history?.destinations.map(d => <option key={JSON.stringify([d.warehouse,d.location])} value={JSON.stringify([d.warehouse,d.location])}>{d.warehouse} / {d.location}</option>)}</select></label>}
      <label>Nama pengambil<input required maxLength={200} value={form.taker} onChange={e => update("taker",e.target.value)}/></label>
      <label>Waktu pengambilan ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input required type="datetime-local" value={form.takenAt} onChange={e => update("takenAt",e.target.value)}/></label>
      <button type="submit" className="primary-button">{posting ? "Menyimpan..." : "Catat Stock Out"}</button>
    </fieldset></form></article>
    <article className="inspection-card"><h2>Riwayat Stock Out</h2><p>Pencarian dalam 200 transaksi terbaru dari gudang ini. Waktu ditampilkan dalam zona waktu perangkat. Gunakan Ringkasan untuk total periode.</p><label>Cari riwayat pengambil / SKU / nama / keperluan<input type="search" value={historySearch} onChange={e => setHistorySearch(e.target.value)} /></label><div className="stock-out-table"><table><thead><tr>{["SKU / nama / batch","Jumlah","Keperluan / rute","Pengambil","Waktu pengambilan","Pencatat / waktu pencatatan"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{history?.records.filter(r => `${r.taker} ${r.product} ${r.product_name} ${r.purpose} ${r.purpose === "PRODUCTION" ? "produksi" : "transfer"}`.toLowerCase().includes(historySearch.toLowerCase())).map(r => <tr key={r.id}><td>{r.product}<br/>{r.product_name}<br/>{r.batch || "Tanpa batch"}</td><td>{r.quantity} {r.unit}<br/>{r.base_quantity} PCS</td><td>{r.purpose}<br/>{r.warehouse} / {r.location}{r.destination_warehouse && <><br/>{"->"} {r.destination_warehouse} / {r.destination_location}</>}</td><td>{r.taker}</td><td>{displayStockOutTime(r.taken_at)}</td><td>{r.recorder}<br/>{displayStockOutTime(r.recorded_at)}</td></tr>)}</tbody></table></div>{history?.records.length===0 && <p>Belum ada Stock Out.</p>}</article>
  </section>;
}