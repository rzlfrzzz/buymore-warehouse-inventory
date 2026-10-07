import { useState } from "react";
import { Clock3, ShieldCheck, Boxes, Users, Info } from "lucide-react";
import {
  number,
  people,
  products,
  roles,
  warehouses,
  type Session,
} from "../services/warehouse";
export function Settings({
  session,
  search,
}: {
  session: Session;
  search: string;
}) {
  const system = session.role === "System Admin";
  const [tab, setTab] = useState(system ? "users" : "master");
  const tabs = system
    ? [
        ["users", "Pengguna & peran"],
        ["warehouses", "Gudang"],
      ]
    : [
        ["master", "Master material"],
        ["shifts", "Shift & jadwal"],
        ["access", "Hak akses"],
      ];
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">PREFERENSI WORKSPACE</div>
        <h1>
          Pengaturan<span className="green-dot">.</span>
        </h1>
        <p>
          {system
            ? "Administrasi global terpisah dari transaksi gudang."
            : "Data acuan dan konteks kerja untuk gudang Anda."}
        </p>
      </div>
      <div className="callout">
        <Info size={18} />
        Master data, jadwal, dan penetapan role saat ini berupa contoh
        baca-saja. Perubahan administratif memerlukan backend dan audit
        permanen.
      </div>
      <section className="panel">
        <div className="tabs">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={tab === id ? "selected" : ""}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "master" && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Produk</th>
                  <th>Satuan dasar</th>
                  <th>Konversi input</th>
                  <th>SKU BigSeller</th>
                  <th>Pelacakan</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter((p) =>
                    `${p.name} ${p.id}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <small>{p.id}</small>
                      </td>
                      <td>{p.unit}</td>
                      <td>
                        1 {p.inputUnit} = {number(p.factor)} {p.unit}
                      </td>
                      <td>{p.sku}</td>
                      <td>
                        {p.batch ? "Batch & kedaluwarsa" : "Total per SKU"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "shifts" && (
          <div className="settings-content">
            <Clock3 size={28} />
            <h2>Shift mencatat, bukan membatasi.</h2>
            <p>
              Label shift ditentukan otomatis berdasarkan jam lokal browser pada
              demo. Backend nantinya menggunakan zona waktu gudang.
            </p>
            <div className="shift-cards">
              {[
                ["Shift 1", "07:00 - 15:00"],
                ["Shift 2", "15:00 - 23:00"],
                ["Shift malam", "23:00 - 07:00"],
              ].map(([name, hours]) => (
                <div key={name}>
                  <span className="online-dot" />
                  <strong>{name}</strong>
                  <p>{hours}</p>
                </div>
              ))}
            </div>
            <p className="muted">
              Jadwal petugas berbasis rentang tanggal belum dihubungkan ke
              backend. Tidak ada pembatasan login atau transaksi berdasarkan
              shift.
            </p>
          </div>
        )}
        {tab === "access" && (
          <div className="settings-content">
            <ShieldCheck size={30} />
            <h2>{people[session.role].title}</h2>
            <p>
              Peran aktif berlaku untuk {warehouses[session.warehouse]}.
              Pemisahan tugas mengikuti matriks permission pada dokumentasi.
            </p>
            <div className="callout">
              Kontrol akses di frontend bukan pengamanan data. Backend wajib
              memvalidasi permission, gudang, pemisahan tugas, dan setiap
              perubahan saldo.
            </div>
          </div>
        )}
        {tab === "users" && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Pengguna demo</th>
                  <th>Peran</th>
                  <th>Cakupan</th>
                </tr>
              </thead>
              <tbody>
                {roles
                  .filter((r) =>
                    `${people[r].name} ${r}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <tr key={r}>
                      <td>
                        <span className="type-label">
                          <Users size={17} />
                          {people[r].name}
                        </span>
                      </td>
                      <td>{r}</td>
                      <td>
                        {r === "System Admin"
                          ? "Global"
                          : "Kedua gudang (demo)"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "warehouses" && (
          <div className="settings-content">
            {Object.entries(warehouses).map(([id, name]) => (
              <div className="line-item" key={id}>
                <Boxes size={24} />
                <strong>{name}</strong>
                <span>{id}</span>
                <span className="badge verified">
                  <i />
                  Aktif
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
