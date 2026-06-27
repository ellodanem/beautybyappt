import { useState, useEffect } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, Check } from "lucide-preact";
import { formatMoney, getCurrency } from "../../shared/currency";
import { pickUnusedServiceColor } from "../../shared/service-colors";

interface Props {
  serviceId?: number;
}

export function AnytimeOfferForm({ serviceId }: Props) {
  const { services, addService, updateService, deleteService, navigate, setError, defaultCurrency } = useApp();
  const existing = serviceId ? services.find((s) => s.id === serviceId) : null;

  const [name, setName] = useState("");
  const [price, setPrice] = useState("75");
  const [duration, setDuration] = useState("60");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setPrice(String(existing.price));
      setDuration(String(existing.duration));
    }
  }, [existing]);

  const currency = getCurrency(defaultCurrency);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Give it a name — e.g. Everyday glam");
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const data = {
        name: name.trim(),
        price: parseFloat(price) || 0,
        duration: parseInt(duration, 10) || 60,
        description: existing?.description || "",
        category: existing?.category || "General",
        color: existing?.color || pickUnusedServiceColor(services.filter((s) => s.active).map((s) => s.color)),
        active: 1,
      };
      if (serviceId) {
        await updateService(serviceId, data);
      } else {
        await addService(data);
      }
      setSaved(true);
      setTimeout(() => navigate("/offers"), 600);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!serviceId || !confirm("Remove this service?")) return;
    await deleteService(serviceId);
    navigate("/offers");
  };

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-12 md:p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/offers")}>
        <ChevronLeft className="mr-1 h-4 w-4" /> Back
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {serviceId ? "Edit service" : "Anytime service"}
        </h1>
        <p className="text-sm text-muted-foreground">Book this any day from your calendar</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="svc-name">What do you call it? *</Label>
            <Input
              id="svc-name"
              className="h-12 text-base"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="Everyday glam"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">Price ({currency.code})</Label>
              <Input
                id="svc-price"
                type="number"
                min={0}
                step="0.01"
                className="h-12 text-base"
                value={price}
                onInput={(e) => setPrice((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-dur">How long (minutes)</Label>
              <Input
                id="svc-dur"
                type="number"
                min={15}
                step="15"
                className="h-12 text-base"
                value={duration}
                onInput={(e) => setDuration((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Preview: {formatMoney(parseFloat(price) || 0, defaultCurrency)} · {duration} min
          </p>
        </CardContent>
      </Card>

      {saved && (
        <p className="flex items-center gap-1 text-sm text-emerald-600">
          <Check className="h-4 w-4" /> Saved!
        </p>
      )}

      <Button className="h-12 w-full text-base" disabled={saving} onClick={handleSave}>
        {saving ? "Saving…" : serviceId ? "Save changes" : "Save — done!"}
      </Button>

      {serviceId && (
        <Button variant="ghost" className="w-full text-destructive" onClick={handleDelete}>
          Remove this service
        </Button>
      )}
    </div>
  );
}
