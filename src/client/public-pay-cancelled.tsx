import { PublicPageShell } from "./components/public-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePublicBranding } from "./hooks/use-public-branding";

export function PublicPayCancelledPage() {
  const publicPage = usePublicBranding();
  const platform = publicPage?.platform ?? null;

  return (
    <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Payment cancelled</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          <p>No payment was taken. Contact the business if you need a new payment link.</p>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
