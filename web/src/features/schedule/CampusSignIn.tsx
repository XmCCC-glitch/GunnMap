import { useEffect, useRef, useState } from "react";
import { syncCampusWithClassLink, type CampusPeriods } from "./campus-sync.js";

interface CampusSignInProps {
  onSynced: (data: CampusPeriods) => void;
}

/** ClassLink sign-in for the Pages site; the password is sent once and then cleared. */
export function CampusSignIn({ onSynced }: CampusSignInProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function submit() {
    if (busy) return;
    controller.current = new AbortController();
    setBusy(true);
    setError("");
    try {
      const data = await syncCampusWithClassLink(username.trim(), password, controller.current.signal);
      setPassword("");
      onSynced(data);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPassword("");
      setError(reason instanceof Error ? reason.message : "Campus sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="campus-sign-in" aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="campus-username">ClassLink student ID</label>
      <input id="campus-username" name="username" autoComplete="username" inputMode="numeric" required
        value={username} disabled={busy} onChange={event => setUsername(event.currentTarget.value)} />
      <label htmlFor="campus-password">ClassLink password</label>
      <input id="campus-password" name="password" type="password" autoComplete="current-password" required
        value={password} disabled={busy} onChange={event => setPassword(event.currentTarget.value)} />
      <button type="submit" className="primary-button" disabled={busy || !username.trim() || !password}>
        {busy ? "Signing in… (up to a minute)" : "Connect Infinite Campus"}
      </button>
      {error && <p className="campus-sign-in-error" role="alert">{error}</p>}
      <p className="campus-sync-note">Test phase: your ID and password go to the GunnMap sync server for this one sign-in and are not saved. Only the resulting period list is kept in this browser.</p>
    </form>
  );
}
