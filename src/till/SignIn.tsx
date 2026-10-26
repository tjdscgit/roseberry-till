import { useState, type FormEvent } from "react";
import { signIn } from "./firebase";

// Shown once per device. Firebase remembers the sign-in after that, even offline.
export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(
        code.includes("network")
          ? "No internet. Connect to sign in the first time."
          : code.includes("too-many")
            ? "Too many tries. Wait a minute and try again."
            : "That email and password don't match."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <form onSubmit={submit}>
        <h1>Roseberry Till</h1>
        <p className="sub">Sign in once on this device.</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn-go" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
