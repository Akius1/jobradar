import { useEffect, useState } from "react";
import {
  authConfigured,
  enabledProviders,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "./supabase.js";

/**
 * The sign-in gate.
 *
 * Shown when someone who is not signed in opens a role. The board itself stays
 * public: this is the point at which we start holding a resume for them, and
 * asking before that rather than at the front door is what keeps the list
 * browsable by anyone.
 *
 * Google is offered first because it is one tap and carries a verified email,
 * and because the alternative asks someone to invent a password for a job board
 * they have known about for ninety seconds.
 */
export default function Auth({ jobTitle, onClose, onSignedIn }) {
  const [mode, setMode] = useState("signup"); // most arrivals here are new
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Escape closes, and the job stays open behind it. Someone who decides not
  // to sign in should not lose the role they were reading.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!authConfigured) {
    return (
      <Shell onClose={onClose}>
        <h2 className="auth-title">Sign-in is not configured</h2>
        <p className="auth-lede">
          This build has no Supabase credentials, so accounts are switched off.
          The board still works without them.
        </p>
        <p className="auth-hint">
          Copy <code>client/.env.local.example</code> to{" "}
          <code>client/.env.local</code> and fill in your project URL and
          publishable key.
        </p>
      </Shell>
    );
  }

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      // Ask before redirecting. signInWithOAuth navigates away immediately and
      // does not reject for a disabled provider, so without this check the user
      // is thrown onto a Supabase error page having lost the role they were
      // reading — and no error handler of ours ever runs.
      const providers = await enabledProviders();
      if (providers.length && !providers.includes("google")) {
        setError("Google sign-in is not enabled on this project yet. Use email below for now.");
        setBusy(false);
        return;
      }
      // Redirects away; the session is picked up from the URL on return.
      const { error } = await signInWithGoogle(window.location.hash);
      if (error) throw error;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await signUpWithEmail(email, password, fullName);
        if (error) throw error;
        // With email confirmation on, there is no session yet and the user has
        // to go and click a link. Saying so is better than a silent no-op.
        if (!data.session) {
          setNotice(`Check ${email} for a confirmation link, then sign in.`);
          setMode("signin");
          return;
        }
        onSignedIn?.(data.session);
      } else {
        const { data, error } = await signInWithEmail(email, password);
        if (error) throw error;
        onSignedIn?.(data.session);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell onClose={onClose}>
      <h2 className="auth-title">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h2>
      <p className="auth-lede">
        {jobTitle ? (
          <>
            To see how your experience lines up with <em>{jobTitle}</em>, we need
            a resume to compare it against.
          </>
        ) : (
          <>Sign in to save roles and get a fit assessment on each one.</>
        )}
      </p>

      <button className="auth-google" onClick={google} disabled={busy}>
        <GoogleMark />
        Continue with Google
      </button>

      <div className="auth-or">
        <span>or</span>
      </div>

      <form className="auth-form" onSubmit={submit}>
        {mode === "signup" && (
          <label>
            <span>Name</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              placeholder="Ada Lovelace"
            />
          </label>
        )}

        <label>
          <span>Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder={mode === "signup" ? "At least 8 characters" : ""}
          />
        </label>

        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="auth-notice">{notice}</p>}

        <button className="auth-submit" type="submit" disabled={busy}>
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="auth-switch">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <button onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
          </>
        ) : (
          <>
            New here?{" "}
            <button onClick={() => { setMode("signup"); setError(null); }}>Create an account</button>
          </>
        )}
      </p>
    </Shell>
  );
}

/** Overlay plus panel. Clicking the backdrop closes, clicking inside does not. */
function Shell({ children, onClose }) {
  return (
    <div className="auth-backdrop" onClick={onClose} role="presentation">
      <div
        className="auth-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className="auth-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

/* Google's mark has fixed brand colours, so this one SVG is deliberately
   exempt from the page palette. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3
        .1-6.7 5.2-.1.3C7.9 41 15.4 46 24 46" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1C2.9 17 2 20.4 2 24s.9 7 2.5 10z" />
      <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 7.9 7 4.5 14l7 5.4c1.8-5.3 6.7-8.8 12.5-8.8" />
    </svg>
  );
}
