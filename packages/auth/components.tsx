"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Layers, LogOut, Workflow } from "lucide-react";
import { authClient } from "./client";
import { safeReturnTo } from "./redirects";
import type { SignupPolicy } from "./signup-policy";

type AuthProvider = { id: string; label: string };

function configuredProviders(): AuthProvider[] {
  const value = process.env.NEXT_PUBLIC_AUTH_PROVIDERS;
  if (!value) return [];
  try {
    const providers = JSON.parse(value);
    return Array.isArray(providers) ? providers : [];
  } catch {
    return [];
  }
}

export function SignInScreen({
  productName,
  productDescription,
  signupPolicy,
}: {
  productName: string;
  productDescription: string;
  signupPolicy: SignupPolicy;
}) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const providers = configuredProviders();
  const returnTo = typeof window === "undefined"
    ? "/"
    : safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password, callbackURL: returnTo })
        : await authClient.signUp.email({ name, email, password, callbackURL: returnTo });
      if (result.error) {
        const status = (result.error as { status?: number }).status;
        if (status === 429) {
          throw new Error("Too many attempts. Wait a few minutes and try again.");
        }
        throw new Error(
          mode === "sign-in"
            ? "Email or password is incorrect."
            : "We could not create that account. Request access if you need help.",
        );
      }
      if (mode === "sign-up") {
        const response = await fetch("/api/onboarding", { method: "POST" });
        if (!response.ok) throw new Error("Your account was created, but workspace setup failed");
      }
      const redirectUrl = (result.data as { url?: string } | null)?.url;
      window.location.assign(safeReturnTo(redirectUrl, returnTo));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <div className="auth-product-mark"><Workflow size={24} /></div>
        <p className="auth-eyebrow">Content · Outreach · Nurture</p>
        <h1>{productName}</h1>
        <p>{productDescription}</p>
        <div className="auth-security-note"><Layers size={17} /><span>Agents draft, the system learns from every send, you approve what ships</span></div>
      </section>
      <section className="auth-panel" aria-label="Authentication">
        {signupPolicy === "open" ? (
          <div className="auth-tabs" role="tablist">
            <button aria-controls="authentication-panel" aria-selected={mode === "sign-in"} className={mode === "sign-in" ? "active" : ""} onClick={() => setMode("sign-in")} role="tab" type="button">Sign in</button>
            <button aria-controls="authentication-panel" aria-selected={mode === "sign-up"} className={mode === "sign-up" ? "active" : ""} onClick={() => setMode("sign-up")} role="tab" type="button">Create account</button>
          </div>
        ) : (
          <div className="auth-access-policy">
            <strong>Access is currently limited.</strong>
            <span>Existing customers can sign in. New teams can <a href="/enterprise">request access</a>.</span>
          </div>
        )}
        <form aria-live="polite" id="authentication-panel" onSubmit={submit} role="tabpanel">
          <div>
            <p className="auth-form-kicker">{mode === "sign-in" ? "Welcome back" : "Create your workspace"}</p>
            <h2>{mode === "sign-in" ? "Sign in to continue" : "Create your account"}</h2>
          </div>
          {mode === "sign-up" && <label>Name<input autoComplete="name" onChange={(event) => setName(event.target.value)} required value={name} /></label>}
          <label>Email<input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
          <label>Password<input autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={mode === "sign-in" ? 8 : 12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={pending} type="submit">
            {pending ? "Please wait..." : mode === "sign-in" ? "Sign in" : "Create account"}<ArrowRight size={17} />
          </button>
        </form>
        {providers.length > 0 && <div className="auth-providers">
          <p><span>or continue with</span></p>
          {providers.map((provider) => <button key={provider.id} onClick={() => authClient.signIn.oauth2({ providerId: provider.id, callbackURL: returnTo })} type="button">{provider.label}</button>)}
        </div>}
      </section>
    </main>
  );
}

export function AccountButton({ compact = false }: { compact?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const { data } = authClient.useSession();
  useEffect(() => setMounted(true), []);
  if (!mounted || !data) return null;
  return <button className="auth-account-button" onClick={async () => { await authClient.signOut(); window.location.assign("/sign-in"); }} title="Sign out" type="button">
    {!compact && <span><strong>{data.user.name}</strong><small>{data.user.email}</small></span>}
    <LogOut size={16} />
  </button>;
}
