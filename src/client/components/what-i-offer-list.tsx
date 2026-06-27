import { useEffect, useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Sparkles, PartyPopper, ChevronDown, ChevronRight } from "lucide-preact";
import { formatMoney } from "../../shared/currency";
import { ShareOfferingLink } from "./share-offering-link";
import { ShareAnytimeLink } from "./share-anytime-link";
import { MobileNavTrigger } from "./mobile-nav-trigger";
import type { OfferingStatus } from "../types";

const EVENT_STATUS: Record<OfferingStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "Not live yet", variant: "secondary" },
  live: { label: "Live", variant: "default" },
  completed: { label: "Done", variant: "outline" },
  archived: { label: "Archived", variant: "outline" },
};

export function WhatIOfferList() {
  const { services, offerings, fetchOfferings, navigate, defaultCurrency } = useApp();
  const [archivedOpen, setArchivedOpen] = useState(false);

  useEffect(() => {
    fetchOfferings().catch(() => {});
  }, [fetchOfferings]);

  const activeServices = services.filter((s) => s.active);
  const activeEvents = offerings.filter((e) => e.status !== "archived");
  const archivedEvents = offerings.filter((e) => e.status === "archived");
  const hasAnything = activeServices.length > 0 || activeEvents.length > 0 || archivedEvents.length > 0;

  const renderEventCard = (event: (typeof offerings)[number]) => {
    const st = EVENT_STATUS[event.status];
    return (
      <Card
        key={`e-${event.id}`}
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => navigate(`/offers/event/${event.id}`)}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{event.name}</span>
              <Badge variant={st.variant}>{st.label}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {event.date_summary || "Dates not set"} · {formatMoney(event.base_price, event.currency || defaultCurrency)}
            </p>
          </div>
          <ShareOfferingLink
            slug={event.slug}
            name={event.name}
            disabled={event.status !== "live"}
          />
        </CardContent>
      </Card>
    );
  };

  const renderArchivedEventCard = (event: (typeof offerings)[number]) => (
    <Card
      key={`e-${event.id}`}
      className="cursor-pointer border-dashed opacity-80 transition-shadow hover:opacity-100 hover:shadow-md"
      onClick={() => navigate(`/offers/event/${event.id}`)}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{event.name}</span>
            <Badge variant="outline">Archived</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {event.date_summary || "Dates not set"} · {formatMoney(event.base_price, event.currency || defaultCurrency)}
          </p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6 p-4 pb-8 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <MobileNavTrigger className="mt-0.5" />
          <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Services</h1>
          <p className="text-sm text-muted-foreground">Everything you sell — everyday services and special events</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeServices.length > 0 && (
            <ShareAnytimeLink
              name="anytime services"
              variant="button"
              buttonLabel="Share anytime"
            />
          )}
          <Button className="h-12 px-6 text-base" onClick={() => navigate("/offers/add")}>
            <Plus className="mr-2 h-5 w-5" /> Add something
          </Button>
        </div>
      </div>

      {!hasAnything ? (
        <Card>
          <CardContent className="space-y-4 py-14 text-center">
            <p className="text-lg font-medium">Nothing here yet</p>
            <p className="text-sm text-muted-foreground">Tap below to add what you do — everyday glam or a Carnival weekend.</p>
            <Button className="h-12 px-8 text-base" onClick={() => navigate("/offers/add")}>Get started</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeEvents.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <PartyPopper className="h-4 w-4" /> Special events
              </h2>
              {activeEvents.map(renderEventCard)}
            </section>
          )}

          {activeServices.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="h-4 w-4" /> Anytime
              </h2>
              {activeServices.map((svc) => (
                <Card
                  key={`s-${svc.id}`}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => navigate(`/offers/anytime/${svc.id}`)}
                >
                  <CardContent className="flex items-center gap-3 p-4">
                    <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold">{svc.name}</span>
                      <p className="text-sm text-muted-foreground">
                        {svc.duration} min · {formatMoney(svc.price, defaultCurrency)}
                      </p>
                    </div>
                    {svc.slug && (
                      <ShareAnytimeLink
                        name={svc.name}
                        serviceSlug={svc.slug}
                      />
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {archivedEvents.length > 0 && (
            <section className="space-y-3 border-t pt-6">
              <button
                type="button"
                className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                onClick={() => setArchivedOpen((open) => !open)}
              >
                {archivedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Archived events ({archivedEvents.length})
              </button>
              {archivedOpen && archivedEvents.map(renderArchivedEventCard)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
