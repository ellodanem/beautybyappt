import { useEffect, useState } from "preact/hooks";
import { api } from "./api";
import { App } from "./app";
import { LoginPage } from "./login-page";

type AuthState = "loading" | "login" | "app";

export function AdminGate() {
  const [state, setState] = useState<AuthState>("loading");
  const [configuredError, setConfiguredError] = useState<string | null>(null);

  useEffect(() => {
    api<{ authenticated: boolean; configured: boolean }>("GET", "/api/auth/me")
      .then((result) => {
        if (!result.configured) {
          setConfiguredError("Admin password is not configured on the server. Set ADMIN_PASSWORD in your environment.");
        }
        setState(result.authenticated ? "app" : "login");
      })
      .catch(() => setState("login"));
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (state === "login") {
    return (
      <LoginPage
        configuredError={configuredError}
        onSuccess={() => {
          setConfiguredError(null);
          setState("app");
        }}
      />
    );
  }

  return <App />;
}
