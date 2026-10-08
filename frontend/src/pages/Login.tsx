import { useState } from "react";
import { ArrowRight, Boxes, ShieldCheck } from "lucide-react";
import {
  people,
  roles,
  warehouses,
  type Role,
  type Session,
  type Warehouse,
} from "../services/warehouse";
export function Login({ login }: { login: (session: Session) => void }) {
  const [role, setRole] = useState<Role>("Admin");
  const [warehouse, setWarehouse] = useState<Warehouse>("GDG-01");
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            buymore<small>WAREHOUSE WORKSPACE</small>
          </span>
        </div>
        <div>
          <span className="eyebrow">RUANG KERJA GUDANG ANDA</span>
          <h1>
            Material teratur.
            <br />
            Tim terhubung.
            <br />
            <em>Kerja lebih tenang.</em>
          </h1>
          <p>
            Dari material pertama datang hingga produksi berjalan.
            <br />
            Semua tercatat dalam satu workspace.
          </p>
        </div>
        <span className="login-story-footer">
          <Boxes size={18} />
          Dibangun untuk operasional Buymore.
        </span>
      </section>
      <section className="login-form">
        <div className="login-inner">
          <span className="subtle-chip">FRONTEND PREVIEW / V0.1</span>
          <h2>Selamat datang kembali.</h2>
          <p>Pilih peran untuk menjelajahi alur kerja gudang.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              login({ role, warehouse });
            }}
          >
            <label>
              Masuk sebagai
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {people[r].title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Gudang
              <select
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value as Warehouse)}
              >
                {Object.entries(warehouses).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button className="button primary" type="submit">
              Masuk ke workspace
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-notice">
            <ShieldCheck size={21} />
            <p>
              Mode demo, tanpa autentikasi sungguhan. Gunakan data contoh saja.
              Data disimpan di browser perangkat ini.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
