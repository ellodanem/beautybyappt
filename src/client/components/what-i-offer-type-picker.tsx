import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, Sparkles, PartyPopper } from "lucide-preact";

export function WhatIOfferTypePicker() {
  const { navigate } = useApp();

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 pb-12 md:p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/offers")}>
        <ChevronLeft className="mr-1 h-4 w-4" /> Back
      </Button>

      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">What are you adding?</h1>
        <p className="mt-2 text-sm text-muted-foreground">Pick one — you can always add more later</p>
      </div>

      <div className="space-y-4">
        <button
          type="button"
          className="w-full text-left"
          onClick={() => navigate("/offers/add/anytime")}
        >
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-4 p-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Anytime service</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  I do this all year — bridal trial, everyday glam, touch-ups.
                </p>
                <p className="mt-2 text-xs font-medium text-primary">Quick setup · 4 fields</p>
              </div>
            </CardContent>
          </Card>
        </button>

        <button
          type="button"
          className="w-full text-left"
          onClick={() => navigate("/offers/add/event")}
        >
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-4 p-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-pink-500/10 text-pink-600">
                <PartyPopper className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Special event</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Carnival, pop-up, or a crazy busy weekend — set your days and times once.
                </p>
                <p className="mt-2 text-xs font-medium text-pink-600">Guided setup · we walk you through it</p>
              </div>
            </CardContent>
          </Card>
        </button>
      </div>
    </div>
  );
}
