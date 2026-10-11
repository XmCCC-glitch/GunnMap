import { useEffect, useState } from "react";
import { syncCampusWithClassLink, type CampusPeriods } from "./campus-sync.js";

interface CampusSignInProps {
  onSynced: (data: CampusPeriods) => void;
  controller: { current: AbortController | null };
}

/** ClassLink sign-in for the Pages site; the password is sent once and then cleared. */
export function CampusSignIn({ onSynced, controller }: CampusSignInProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => controller.current?.abort(), [controller]);

  async function submit() {
    if (busy) return;
    const request = new AbortController();
    controller.current = request;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      request.abort();
    }, 120_000);
    setBusy(true);
    setError("");
    try {
      const data = await syncCampusWithClassLink(username.trim(), password, request.signal);
      if (request.signal.aborted) return;
      onSynced(data);
    } catch (reason) {
      if (timedOut) setError("Campus sign-in timed out. Try again.");
      else if (request.signal.aborted) return;
      else if (!request.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Campus sync failed.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === request) controller.current = null;
      setPassword("");
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
        {busy ? "Signing in… (up to two minutes)" : "Connect Infinite Campus"}
      </button>
      {error && <p className="campus-sign-in-error" role="alert">{error}</p>}
      <p className="campus-sync-note">Test phase: your ID and password go to the GunnMap sync server for this one sign-in and are not saved. Only the resulting period list is kept in this browser.</p>
    </form>
  );
}
