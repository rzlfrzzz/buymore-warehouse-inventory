import { useState } from "react";
import { api } from "../services/api";

export function AccountPin() {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <details className="panel">
    <summary>Akun saya / Atur PIN login</summary>
    <p>Opsional untuk karyawan. Password tetap dapat digunakan.</p>
    <form onSubmit={async (event) => {
      event.preventDefault();
      setMessage("");
      if (!/^[0-9]{6}$/.test(pin) || pin !== confirm) {
        setMessage("PIN harus 6 digit dan konfirmasi harus sama.");
        setPassword(""); setPin(""); setConfirm("");
        return;
      }
      setBusy(true);
      const input = { password, pin };
      setPassword(""); setPin(""); setConfirm("");
      try {
        await api("/account/pin", undefined, input);
        setMessage("PIN login disimpan.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "PIN gagal disimpan.");
      } finally { setBusy(false); }
    }}>
      <label>Password saat ini<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={busy} /></label>
      <label>PIN baru<input type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} required disabled={busy} /></label>
      <label>Konfirmasi PIN<input type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required disabled={busy} /></label>
      <button className="button primary" disabled={busy}>Simpan PIN</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}