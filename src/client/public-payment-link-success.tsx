import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicPageShell } from "./components/public-page-shell";
import { BusinessHeader } from "./components/business-header";
import { usePublicBranding } from "./hooks/use-public-branding";

export function PublicPaymentLinkSuccessPage({ token }: { token: string }) {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");
  const publicPage = usePublicBranding();
  const publicBranding = publicPage?.branding ?? null;
  const platform = publicPage?.platform ?? null;

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setStatus("error");
      setMessage("Missing payment session.");
      return;
    }
    api<{ already_done: boolean; pending_payment_id: number | null }>(
      "GET",
      `/api/pay-link/public/${token}/complete?session_id=${encodeURIComponent(sessionId)}`,
    )
      .then(() => {
        setStatus("ok");
        setMessage("Payment received. Thank you.");
      })
      .catch((err) => {
        setStatus("error");
        setMessage((err as Error).message);
      });
  }, [token]);

  return (
    <PublicPageShell platform={platform}>
      <div className="mx-auto max-w-md space-y-4 pt-4">
        {publicBranding && <BusinessHeader branding={publicBranding} />}
        <Card>
          <CardHeader>
            <CardTitle>{status === "ok" ? "Thank you" : status === "loading" ? "Confirming…" : "Something went wrong"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {status === "loading" ? "Please wait while we confirm your payment." : message}
          </CardContent>
        </Card>
      </div>
    </PublicPageShell>
  );
}
