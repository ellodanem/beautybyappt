import { useState } from "preact/hooks";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessHeader } from "./components/business-header";
import { usePublicBranding } from "./hooks/use-public-branding";

export function LoginPage({
  onSuccess,
  configuredError,
}: {
  onSuccess: () => void;
  configuredError: string | null;
}) {
  const brandingState = usePublicBranding();
  const branding = brandingState?.branding ?? { business_name: "", business_tagline: "", logo_url: "" };
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api("POST", "/api/auth/login", { password });
      onSuccess();
    } catch (err) {
      setError((err as Error).message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <BusinessHeader branding={branding} className="justify-center" />
          <div className="space-y-1 text-center">
            <CardTitle>Staff sign in</CardTitle>
            <CardDescription>Enter your business password to manage appointments.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {configuredError ? (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {configuredError}
            </p>
          ) : null}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                disabled={Boolean(configuredError) || submitting}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={Boolean(configuredError) || submitting || !password}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
