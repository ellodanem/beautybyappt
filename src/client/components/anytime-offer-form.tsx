import { useState, useEffect } from "preact/hooks";
import { useApp } from "../context";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, Check, Plus, Trash2 } from "lucide-preact";
import { formatMoney, getCurrency } from "../../shared/currency";
import { pickUnusedServiceColor } from "../../shared/service-colors";
import type { ServiceAddon } from "../types";

interface Props {
  serviceId?: number;
}

export function AnytimeOfferForm({ serviceId }: Props) {
  const { services, addService, updateService, deleteService, navigate, setError, defaultCurrency } = useApp();
  const existing = serviceId ? services.find((s) => s.id === serviceId) : null;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("75");
  const [duration, setDuration] = useState("60");
  const [allowAddons, setAllowAddons] = useState(false);
  const [addons, setAddons] = useState<ServiceAddon[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!serviceId) return;
    api<{ service: { allow_addons?: number }; addons: ServiceAddon[] }>("GET", `/api/services/${serviceId}`)
      .then((data) => {
        setAllowAddons(!!data.service.allow_addons);
        setAddons(data.addons.length > 0 ? data.addons : [{ name: "", price: 0, extra_duration: 0 }]);
      })
      .catch((err) => setError((err as Error).message));
  }, [serviceId, setError]);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setDescription(existing.description || "");
      setPrice(String(existing.price));
      setDuration(String(existing.duration));
      if (!serviceId) {
        setAllowAddons(!!existing.allow_addons);
      }
    }
  }, [existing, serviceId]);

  const currency = getCurrency(defaultCurrency);

  const updateAddon = (index: number, field: keyof ServiceAddon, value: string | number) => {
    setAddons((prev) => prev.map((addon, i) => (i === index ? { ...addon, [field]: value } : addon)));
  };

  const addAddonRow = () => {
    setAddons((prev) => [...prev, { name: "", price: 0, extra_duration: 0 }]);
  };

  const removeAddonRow = (index: number) => {
    setAddons((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Give it a name — e.g. Everyday glam");
      return;
    }
    if (allowAddons) {
      const validAddons = addons.filter((a) => a.name.trim());
      if (validAddons.length === 0) {
        setError("Add at least one extra, or turn off extras");
        return;
      }
    }
    setSaving(true);
    setSaved(false);
    try {
      const payload = {
        name: name.trim(),
        price: parseFloat(price) || 0,
        duration: parseInt(duration, 10) || 60,
        description: description.trim(),
        category: existing?.category || "General",
        color: existing?.color || pickUnusedServiceColor(services.filter((s) => s.active).map((s) => s.color)),
        active: 1,
        allow_addons: allowAddons ? 1 : 0,
        addons: allowAddons ? addons.filter((a) => a.name.trim()) : [],
      };
      if (serviceId) {
        await updateService(serviceId, payload);
      } else {
        await addService(payload);
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
          <div className="space-y-1.5">
            <Label htmlFor="svc-description">Description</Label>
            <Textarea
              id="svc-description"
              rows={3}
              value={description}
              onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              placeholder="What's included? e.g. Full face glam with lashes"
            />
            <p className="text-xs text-muted-foreground">Optional — shown to clients on your booking page</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Extras</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={allowAddons}
              onChange={(e) => {
                const enabled = (e.target as HTMLInputElement).checked;
                setAllowAddons(enabled);
                if (enabled && addons.length === 0) {
                  setAddons([{ name: "", price: 0, extra_duration: 0 }]);
                }
              }}
            />
            <span>
              <span className="font-medium">Let clients add extras</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Optional add-ons like lashes, gems, or touch-ups — clients pick what they want when booking.
              </span>
            </span>
          </label>

          {allowAddons && (
            <div className="space-y-3">
              <Label>Extras clients can add</Label>
              {addons.map((addon, i) => (
                <div key={addon.id ?? i} className="flex gap-2">
                  <Input
                    placeholder="e.g. Lashes"
                    className="h-11"
                    value={addon.name}
                    onInput={(e) => updateAddon(i, "name", (e.target as HTMLInputElement).value)}
                  />
                  <Input
                    type="number"
                    placeholder={`+${currency.code}`}
                    className="h-11 w-24"
                    value={addon.price}
                    onInput={(e) => updateAddon(i, "price", parseFloat((e.target as HTMLInputElement).value) || 0)}
                  />
                  {addons.length > 1 && (
                    <Button variant="ghost" size="icon" onClick={() => removeAddonRow(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addAddonRow}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add extra
              </Button>
            </div>
          )}
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
