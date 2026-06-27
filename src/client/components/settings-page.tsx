import { useState, useEffect, useRef } from "preact/hooks";

import { useApp } from "../context";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { getCurrency } from "../../shared/currency";

import { formatTimeInTimezone, timezoneOptionsForCountry } from "../../shared/locale";

import { MAX_LOGO_DATA_URL_BYTES } from "../../shared/branding";

import { BusinessHeader } from "./business-header";

import { MobileNavTrigger } from "./mobile-nav-trigger";



export function SettingsPage() {
  const {
    defaultCurrency,
    currencyOptions,
    updateDefaultCurrency,
    businessLocale,
    localeCountryOptions,
    updateBusinessLocale,
    branding,
    updateBranding,
    uploadBrandingLogo,
    setError,
    navigate,
    blockRegularOnEventDays,
    updateBlockRegularOnEventDays,
    stripeConfigured,
    stripeWebhookConfigured,
    stripePaymentsEnabled,
    updateStripePaymentsEnabled,
    notificationSettings,
    updateNotificationSettings,
    emailDomain,
    connectEmailDomain,
    verifyEmailDomain,
    refreshEmailDomain,
    setEmailFromAddress,
  } = useApp();



  const [selected, setSelected] = useState(defaultCurrency);

  const [currencySaving, setCurrencySaving] = useState(false);

  const [currencySaved, setCurrencySaved] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(businessLocale.country);
  const [selectedTimezone, setSelectedTimezone] = useState(businessLocale.timezone);
  const [localeSaving, setLocaleSaving] = useState(false);
  const [localeSaved, setLocaleSaved] = useState(false);
  const [localTimePreview, setLocalTimePreview] = useState("");
  const [eventOverrideSaving, setEventOverrideSaving] = useState(false);
  const [stripeSaving, setStripeSaving] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationSaved, setNotificationSaved] = useState(false);
  const [emailReplyTo, setEmailReplyTo] = useState(notificationSettings.email_reply_to);
  const [domainInput, setDomainInput] = useState("");
  const [fromAddressInput, setFromAddressInput] = useState("");
  const [emailDomainSaving, setEmailDomainSaving] = useState(false);



  const [name, setName] = useState(branding.business_name);

  const [tagline, setTagline] = useState(branding.business_tagline);

  const [logoPreview, setLogoPreview] = useState(branding.logo_url);

  const [brandingSaving, setBrandingSaving] = useState(false);

  const [brandingSaved, setBrandingSaved] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);



  useEffect(() => {

    setSelected(defaultCurrency);

  }, [defaultCurrency]);

  useEffect(() => {
    setSelectedCountry(businessLocale.country);
    setSelectedTimezone(businessLocale.timezone);
  }, [businessLocale.country, businessLocale.timezone]);

  useEffect(() => {
    const tick = () => setLocalTimePreview(formatTimeInTimezone(selectedTimezone));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [selectedTimezone]);

  const timezoneOptions = timezoneOptionsForCountry(selectedCountry);
  const localeDirty = selectedCountry !== businessLocale.country
    || selectedTimezone !== businessLocale.timezone;



  useEffect(() => {

    setName(branding.business_name);

    setTagline(branding.business_tagline);

    setLogoPreview(branding.logo_url);

  }, [branding]);

  useEffect(() => {
    setEmailReplyTo(notificationSettings.email_reply_to);
  }, [notificationSettings.email_reply_to]);

  useEffect(() => {
    setDomainInput(emailDomain.domain);
    setFromAddressInput(emailDomain.from_address);
  }, [emailDomain.domain, emailDomain.from_address]);

  const domainStatusLabel = (status: string) => {
    if (status === "verified") return { text: "Verified", className: "text-emerald-700" };
    if (status === "failed" || status === "temporary_failure") return { text: "Failed", className: "text-destructive" };
    if (status === "pending" || status === "not_started") return { text: "Pending DNS", className: "text-amber-700" };
    return { text: "Not connected", className: "text-muted-foreground" };
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("Could not copy to clipboard");
    }
  };



  const handleCurrencySave = async () => {

    setCurrencySaving(true);

    setCurrencySaved(false);

    try {

      await updateDefaultCurrency(selected);

      setCurrencySaved(true);

    } catch (err) {

      setError((err as Error).message);

    } finally {

      setCurrencySaving(false);

    }

  };



  const handleLogoSelect = async (e: Event) => {

    const input = e.target as HTMLInputElement;

    const file = input.files?.[0];

    if (!file) return;



    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

    if (!allowed.includes(file.type)) {

      setError("Logo must be PNG, JPEG, WebP, or SVG.");

      input.value = "";

      return;

    }

    if (file.size > MAX_LOGO_DATA_URL_BYTES) {

      setError("Logo must be 512 KB or smaller.");

      input.value = "";

      return;

    }



    const reader = new FileReader();

    reader.onload = async () => {

      const dataUrl = reader.result as string;

      setLogoPreview(dataUrl);

      setBrandingSaved(false);

      try {

        await uploadBrandingLogo(dataUrl);

      } catch (err) {

        setError((err as Error).message);

        setLogoPreview(branding.logo_url);

      }

    };

    reader.readAsDataURL(file);

    input.value = "";

  };



  const handleRemoveLogo = () => {

    setLogoPreview("");

    setBrandingSaved(false);

  };



  const handleBrandingSave = async () => {

    if (!name.trim()) {

      setError("Business name is required.");

      return;

    }

    setBrandingSaving(true);

    setBrandingSaved(false);

    try {

      await updateBranding({

        business_name: name.trim(),

        business_tagline: tagline.trim(),

        logo_url: logoPreview || null,

      });

      setBrandingSaved(true);

    } catch (err) {

      setError((err as Error).message);

    } finally {

      setBrandingSaving(false);

    }

  };



  const previewBranding = {

    business_name: name,

    business_tagline: tagline,

    logo_url: logoPreview,

  };



  const brandingDirty =

    name.trim() !== branding.business_name.trim()

    || tagline.trim() !== branding.business_tagline.trim()

    || logoPreview !== branding.logo_url;



  const current = getCurrency(selected);



  return (

    <div className="space-y-4 p-4 pb-8 md:p-6">

      <div className="flex items-start gap-2">

        <MobileNavTrigger className="mt-0.5" />

        <div>

        <h1 className="text-xl font-bold tracking-tight md:text-2xl">Settings</h1>

        <p className="text-sm text-muted-foreground">Branding and business defaults</p>

        </div>

      </div>



      <Card className="max-w-lg">

        <CardHeader>

          <CardTitle className="text-base">Branding</CardTitle>

        </CardHeader>

        <CardContent className="space-y-4">

          <p className="text-sm text-muted-foreground">

            Your business name and logo appear in the staff app and on client booking pages.

          </p>

          <div className="space-y-1.5">

            <Label htmlFor="business-name">Business name *</Label>

            <Input

              id="business-name"

              className="h-11"

              value={name}

              onInput={(e) => setName((e.target as HTMLInputElement).value)}

              placeholder="Carnival Beauty Hub"

            />

          </div>

          <div className="space-y-1.5">

            <Label htmlFor="business-tagline">Tagline (optional)</Label>

            <Input

              id="business-tagline"

              className="h-11"

              value={tagline}

              onInput={(e) => setTagline((e.target as HTMLInputElement).value)}

              placeholder="St. Lucia · Mobile Glam"

            />

          </div>

          <div className="space-y-2">

            <Label>Logo</Label>

            <div className="flex flex-wrap items-center gap-3">

              <input

                ref={fileRef}

                type="file"

                accept="image/png,image/jpeg,image/webp,image/svg+xml"

                className="hidden"

                onChange={handleLogoSelect}

              />

              <Button type="button" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>

                Upload logo

              </Button>

              {logoPreview && (

                <Button type="button" variant="ghost" className="h-11" onClick={handleRemoveLogo}>

                  Remove

                </Button>

              )}

            </div>

            <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, or SVG. Max 512 KB.</p>

          </div>

          <div className="rounded-lg border bg-muted/30 p-4">

            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>

            <BusinessHeader

              branding={previewBranding}

              subtitle="Confirm your booking"

            />

          </div>

          {brandingSaved && <p className="text-sm text-emerald-600">Branding saved.</p>}

          <Button

            className="h-11"

            disabled={brandingSaving || (!brandingDirty && !!branding.business_name.trim())}

            onClick={handleBrandingSave}

          >

            {brandingSaving ? "Saving…" : "Save branding"}

          </Button>

        </CardContent>

      </Card>



      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Special event days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={blockRegularOnEventDays}
              onChange={async (e) => {
                setEventOverrideSaving(true);
                try {
                  await updateBlockRegularOnEventDays((e.target as HTMLInputElement).checked);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setEventOverrideSaving(false);
                }
              }}
            />
            <span>
              <span className="font-medium">Block regular bookings on event days</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                When a special event is live, clients can only be booked through event times — not bridal or everyday services. You can turn this off per event.
              </span>
            </span>
          </label>
          {eventOverrideSaving && <p className="text-sm text-muted-foreground">Saving…</p>}
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Stripe deposits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Booking links can require a deposit paid through Stripe Checkout before the appointment is confirmed.
          </p>
          <div className="rounded-lg border p-3">
            <p>
              <span className="font-medium">API key: </span>
              {stripeConfigured
                ? <span className="text-emerald-700">Configured</span>
                : <span className="text-amber-700">Not set</span>}
            </p>
            <p className="mt-1">
              <span className="font-medium">Webhook: </span>
              {stripeWebhookConfigured
                ? <span className="text-emerald-700">Configured</span>
                : <span className="text-muted-foreground">Optional for local — use Stripe CLI</span>}
            </p>
            <p className="mt-1">
              <span className="font-medium">Online payments: </span>
              {!stripeConfigured
                ? <span className="text-muted-foreground">Off (no API key)</span>
                : stripePaymentsEnabled
                  ? <span className="text-emerald-700">Enabled</span>
                  : <span className="text-amber-700">Disabled</span>}
            </p>
          </div>
          <label className={`flex items-start gap-3 ${stripeConfigured ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
            <input
              type="checkbox"
              className="mt-1"
              checked={stripePaymentsEnabled}
              disabled={!stripeConfigured || stripeSaving}
              onChange={async (e) => {
                setStripeSaving(true);
                try {
                  await updateStripePaymentsEnabled((e.target as HTMLInputElement).checked);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setStripeSaving(false);
                }
              }}
            />
            <span>
              <span className="font-medium">Accept online payments</span>
              <span className="mt-1 block text-muted-foreground">
                Turn this on only when you are ready to charge clients. Booking links still work when off — clients confirm without paying.
              </span>
            </span>
          </label>
          {stripeSaving && <p className="text-sm text-muted-foreground">Saving…</p>}
          {!stripeConfigured && (
            <p className="text-xs text-muted-foreground">
              Add <code className="text-foreground">STRIPE_SECRET_KEY</code> to{" "}
              <code className="text-foreground">.dev.vars</code> (or production secrets) and restart{" "}
              <code className="text-foreground">pnpm run dev</code>.
            </p>
          )}
          {stripeConfigured && stripePaymentsEnabled && !stripeWebhookConfigured && (
            <p className="text-xs text-muted-foreground">
              Forward webhooks locally:{" "}
              <code className="text-foreground">stripe listen --forward-to localhost:8787/api/webhooks/stripe</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Email domain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Verify your business domain so confirmations and reminders send from{" "}
            <span className="text-foreground">bookings@yourdomain.com</span> instead of a generic address.
            Use a subdomain like <code className="text-foreground">send.yourbusiness.com</code> if you already use email on your root domain.
          </p>
          <div className="rounded-lg border p-3 space-y-1">
            <p>
              <span className="font-medium">Resend API: </span>
              {emailDomain.resend_configured
                ? <span className="text-emerald-700">Configured</span>
                : <span className="text-amber-700">Not set</span>}
            </p>
            {emailDomain.domain && (
              <p>
                <span className="font-medium">Domain: </span>
                {emailDomain.domain}{" "}
                <span className={domainStatusLabel(emailDomain.status).className}>
                  ({domainStatusLabel(emailDomain.status).text})
                </span>
              </p>
            )}
            {emailDomain.can_send_from_domain && (
              <p>
                <span className="font-medium">Sending from: </span>
                <span className="text-emerald-700">{emailDomain.from_address}</span>
              </p>
            )}
          </div>
          {!emailDomain.resend_configured && (
            <p className="text-xs text-muted-foreground">
              Add <code className="text-foreground">RESEND_API_KEY</code> to <code className="text-foreground">.dev.vars</code> first.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email-domain">Domain to verify</Label>
            <div className="flex gap-2">
              <Input
                id="email-domain"
                className="h-11 flex-1"
                value={domainInput}
                disabled={!emailDomain.resend_configured || emailDomainSaving}
                onInput={(e) => setDomainInput((e.target as HTMLInputElement).value)}
                placeholder="send.yourbusiness.com"
              />
              <Button
                type="button"
                className="h-11 shrink-0"
                disabled={!emailDomain.resend_configured || emailDomainSaving || !domainInput.trim()}
                onClick={async () => {
                  setEmailDomainSaving(true);
                  try {
                    await connectEmailDomain(domainInput.trim());
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setEmailDomainSaving(false);
                  }
                }}
              >
                Connect
              </Button>
            </div>
          </div>
          {emailDomain.records.length > 0 && (
            <div className="space-y-2">
              <p className="font-medium">Add these DNS records at your domain provider</p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="p-2">Type</th>
                      <th className="p-2">Name</th>
                      <th className="p-2">Value</th>
                      <th className="p-2 w-16" />
                    </tr>
                  </thead>
                  <tbody>
                    {emailDomain.records.map((rec, i) => (
                      <tr key={`${rec.type}-${rec.name}-${i}`} className="border-b last:border-0 align-top">
                        <td className="p-2 font-mono">{rec.type}</td>
                        <td className="p-2 font-mono break-all">{rec.name}</td>
                        <td className="p-2 font-mono break-all">{rec.value}{rec.priority != null ? ` (prio ${rec.priority})` : ""}</td>
                        <td className="p-2">
                          <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => copyText(rec.value)}>
                            Copy
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  disabled={emailDomainSaving}
                  onClick={async () => {
                    setEmailDomainSaving(true);
                    try {
                      await verifyEmailDomain();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setEmailDomainSaving(false);
                    }
                  }}
                >
                  Check verification
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10"
                  disabled={emailDomainSaving}
                  onClick={async () => {
                    setEmailDomainSaving(true);
                    try {
                      await refreshEmailDomain();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setEmailDomainSaving(false);
                    }
                  }}
                >
                  Refresh status
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">DNS can take up to 72 hours to propagate. Re-check after adding records.</p>
            </div>
          )}
          {emailDomain.status === "verified" && (
            <div className="space-y-1.5 border-t pt-4">
              <Label htmlFor="email-from">From address</Label>
              <div className="flex gap-2">
                <Input
                  id="email-from"
                  className="h-11 flex-1"
                  type="email"
                  value={fromAddressInput}
                  disabled={emailDomainSaving}
                  onInput={(e) => setFromAddressInput((e.target as HTMLInputElement).value)}
                  placeholder={`bookings@${emailDomain.domain}`}
                />
                <Button
                  type="button"
                  className="h-11 shrink-0"
                  disabled={emailDomainSaving || fromAddressInput === emailDomain.from_address}
                  onClick={async () => {
                    setEmailDomainSaving(true);
                    try {
                      await setEmailFromAddress(fromAddressInput.trim());
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setEmailDomainSaving(false);
                    }
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
          {emailDomainSaving && <p className="text-muted-foreground">Working…</p>}
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Booking confirmations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Send clients a confirmation when an appointment is booked — via email today, with SMS and WhatsApp coming soon.
          </p>
          <div className="rounded-lg border p-3">
            <p>
              <span className="font-medium">Email provider (Resend): </span>
              {notificationSettings.email_configured
                ? <span className="text-emerald-700">Configured</span>
                : <span className="text-amber-700">Not set — logs to console in dev</span>}
            </p>
            {emailDomain.can_send_from_domain && (
              <p className="mt-1">
                <span className="font-medium">From: </span>
                <span className="text-emerald-700">{emailDomain.from_address}</span>
              </p>
            )}
          </div>
          {!notificationSettings.email_configured && (
            <p className="text-xs text-muted-foreground">
              Add <code className="text-foreground">RESEND_API_KEY=re_…</code> and optional{" "}
              <code className="text-foreground">EMAIL_FROM=bookings@yourdomain.com</code> to{" "}
              <code className="text-foreground">.dev.vars</code>, then restart dev.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={notificationSettings.email_enabled}
              onChange={async (e) => {
                setNotificationSaving(true);
                try {
                  await updateNotificationSettings({ email_enabled: (e.target as HTMLInputElement).checked });
                  setNotificationSaved(true);
                  setTimeout(() => setNotificationSaved(false), 2000);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setNotificationSaving(false);
                }
              }}
            />
            <span>
              <span className="font-medium">Email confirmation</span>
              <span className="mt-1 block text-muted-foreground">
                Includes date, time, location, travel fee, and payment receipt when applicable.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 opacity-90">
            <input
              type="checkbox"
              className="mt-1"
              checked={notificationSettings.sms_enabled}
              onChange={async (e) => {
                setNotificationSaving(true);
                try {
                  await updateNotificationSettings({ sms_enabled: (e.target as HTMLInputElement).checked });
                  setNotificationSaved(true);
                  setTimeout(() => setNotificationSaved(false), 2000);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setNotificationSaving(false);
                }
              }}
            />
            <span>
              <span className="font-medium">SMS confirmation</span>
              <span className="mt-1 block text-xs text-amber-700">Placeholder — logs message to server console (Twilio coming soon)</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 opacity-90">
            <input
              type="checkbox"
              className="mt-1"
              checked={notificationSettings.whatsapp_enabled}
              onChange={async (e) => {
                setNotificationSaving(true);
                try {
                  await updateNotificationSettings({ whatsapp_enabled: (e.target as HTMLInputElement).checked });
                  setNotificationSaved(true);
                  setTimeout(() => setNotificationSaved(false), 2000);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setNotificationSaving(false);
                }
              }}
            />
            <span>
              <span className="font-medium">WhatsApp confirmation</span>
              <span className="mt-1 block text-xs text-amber-700">Placeholder — logs message to server console (WhatsApp Business API coming soon)</span>
            </span>
          </label>
          <div className="border-t pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Reminders</p>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={notificationSettings.remind_24h_enabled}
                onChange={async (e) => {
                  setNotificationSaving(true);
                  try {
                    await updateNotificationSettings({ remind_24h_enabled: (e.target as HTMLInputElement).checked });
                    setNotificationSaved(true);
                    setTimeout(() => setNotificationSaved(false), 2000);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setNotificationSaving(false);
                  }
                }}
              />
              <span>
                <span className="font-medium">24 hours before</span>
                <span className="mt-1 block text-muted-foreground">
                  Includes address for on-location bookings. Deposit payers also get balance due.
                </span>
              </span>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={notificationSettings.remind_2h_enabled}
                onChange={async (e) => {
                  setNotificationSaving(true);
                  try {
                    await updateNotificationSettings({ remind_2h_enabled: (e.target as HTMLInputElement).checked });
                    setNotificationSaved(true);
                    setTimeout(() => setNotificationSaved(false), 2000);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setNotificationSaving(false);
                  }
                }}
              />
              <span>
                <span className="font-medium">2 hours before</span>
                <span className="mt-1 block text-muted-foreground">
                  Final reminder before start time. Runs hourly via cron.
                </span>
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-reply-to">Reply-to email (optional)</Label>
            <Input
              id="email-reply-to"
              className="h-11"
              type="email"
              value={emailReplyTo}
              onInput={(e) => setEmailReplyTo((e.target as HTMLInputElement).value)}
              placeholder="you@yourbusiness.com"
            />
          </div>
          <Button
            className="h-11"
            variant="outline"
            disabled={notificationSaving || emailReplyTo === notificationSettings.email_reply_to}
            onClick={async () => {
              setNotificationSaving(true);
              try {
                await updateNotificationSettings({ email_reply_to: emailReplyTo });
                setNotificationSaved(true);
                setTimeout(() => setNotificationSaved(false), 2000);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setNotificationSaving(false);
              }
            }}
          >
            Save reply-to
          </Button>
          {notificationSaving && <p className="text-muted-foreground">Saving…</p>}
          {notificationSaved && <p className="text-emerald-600">Notification settings saved.</p>}
        </CardContent>
      </Card>

      <Card className="max-w-lg">

        <CardHeader>

          <CardTitle className="text-base">Location &amp; timezone</CardTitle>

        </CardHeader>

        <CardContent className="space-y-4">

          <p className="text-sm text-muted-foreground">

            Where your business operates. Appointment times, reminders, and the calendar use this timezone.

          </p>

          <div className="space-y-1.5">

            <Label htmlFor="business-country">Country</Label>

            <select

              id="business-country"

              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"

              value={selectedCountry}

              onChange={(e) => {

                const code = (e.target as HTMLSelectElement).value;

                setSelectedCountry(code);

                const tzOpts = timezoneOptionsForCountry(code);

                setSelectedTimezone(tzOpts[0]?.value ?? businessLocale.timezone);

                setLocaleSaved(false);

              }}

            >

              {localeCountryOptions.map((opt) => (

                <option key={opt.value} value={opt.value}>{opt.label}</option>

              ))}

            </select>

          </div>

          <div className="space-y-1.5">

            <Label htmlFor="business-timezone">Timezone</Label>

            <select

              id="business-timezone"

              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"

              value={selectedTimezone}

              disabled={timezoneOptions.length <= 1}

              onChange={(e) => {

                setSelectedTimezone((e.target as HTMLSelectElement).value);

                setLocaleSaved(false);

              }}

            >

              {timezoneOptions.map((opt) => (

                <option key={opt.value} value={opt.value}>{opt.label}</option>

              ))}

            </select>

          </div>

          {localTimePreview && (

            <p className="text-sm">

              Current time: <span className="font-semibold">{localTimePreview}</span>

            </p>

          )}

          {localeSaved && <p className="text-sm text-emerald-600">Saved.</p>}

          <Button

            className="h-11"

            disabled={localeSaving || !localeDirty}

            onClick={async () => {

              setLocaleSaving(true);

              setLocaleSaved(false);

              try {

                await updateBusinessLocale(selectedCountry, selectedTimezone);

                setLocaleSaved(true);

              } catch (err) {

                setError((err as Error).message);

              } finally {

                setLocaleSaving(false);

              }

            }}

          >

            {localeSaving ? "Saving…" : "Save location"}

          </Button>

        </CardContent>

      </Card>



      <Card className="max-w-lg">

        <CardHeader>

          <CardTitle className="text-base">Default currency</CardTitle>

        </CardHeader>

        <CardContent className="space-y-4">

          <p className="text-sm text-muted-foreground">

            Used for new booking links unless you choose a different currency for a specific link.

            Stripe will need to support this currency when payments are enabled.

          </p>

          <div className="space-y-1.5">

            <Label htmlFor="default-currency">Currency</Label>

            <select

              id="default-currency"

              className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"

              value={selected}

              onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}

            >

              {currencyOptions.map((opt) => (

                <option key={opt.value} value={opt.value}>{opt.label}</option>

              ))}

            </select>

          </div>

          <p className="text-sm">

            Preview: <span className="font-semibold">{current.symbol}150.00 {current.code}</span>

          </p>

          {currencySaved && <p className="text-sm text-emerald-600">Saved.</p>}

          <Button className="h-11" disabled={currencySaving || selected === defaultCurrency} onClick={handleCurrencySave}>

            {currencySaving ? "Saving…" : "Save default"}

          </Button>

        </CardContent>

      </Card>

      <Card className="max-w-lg">
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="font-medium">Product inventory</p>
            <p className="text-sm text-muted-foreground">Shampoo, tools, retail stock</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/products")}>Open</Button>
        </CardContent>
      </Card>

    </div>

  );

}


