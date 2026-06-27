import { useEffect } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-preact";
import { formatMoney } from "../../shared/currency";
import type { OfferingStatus } from "../types";

const STATUS_VARIANT: Record<OfferingStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  live: "default",
  completed: "outline",
  archived: "outline",
};

export function OfferingsList() {
  const { offerings, fetchOfferings, navigate, defaultCurrency } = useApp();

  useEffect(() => {
    fetchOfferings().catch(() => {});
  }, [fetchOfferings]);

  return (
    <div className="space-y-4 p-4 pb-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Offerings</h1>
          <p className="text-sm text-muted-foreground">Seasonal events like Carnival — configure once, book all season</p>
        </div>
        <Button className="h-11" onClick={() => navigate("/offerings/new")}>
          <Plus className="mr-2 h-4 w-4" /> New offering
        </Button>
      </div>

      {offerings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No offerings yet.</p>
            <p className="mt-1 text-sm">Create a Carnival or seasonal event with date windows and time slots.</p>
            <Button className="mt-4" onClick={() => navigate("/offerings/new")}>Create your first offering</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {offerings.map((offering) => (
            <Card key={offering.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => navigate(`/offerings/${offering.id}`)}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: offering.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{offering.name}</h2>
                    <Badge variant={STATUS_VARIANT[offering.status]}>{offering.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {offering.date_summary || "No dates"} · {offering.capacity_per_slot} per slot · {formatMoney(offering.base_price, offering.currency || defaultCurrency)} base
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/offerings/${offering.id}`); }}>
                  {offering.status === "draft" || offering.status === "live" ? "Edit" : offering.status === "archived" ? "View / duplicate" : "View"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
