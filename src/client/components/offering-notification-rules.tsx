import { Plus, Trash2 } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type NotificationRuleUnit = "hours" | "days";

export interface NotificationRuleDraft {
  id?: number;
  email_template_id: number;
  amount: number;
  unit: NotificationRuleUnit;
  active: boolean;
}

export function hoursBeforeFromDraft(rule: Pick<NotificationRuleDraft, "amount" | "unit">): number {
  const amount = Math.max(1, Math.round(rule.amount));
  return rule.unit === "days" ? amount * 24 : amount;
}

export function draftFromHoursBefore(hoursBefore: number): Pick<NotificationRuleDraft, "amount" | "unit"> {
  if (hoursBefore >= 24 && hoursBefore % 24 === 0) {
    return { amount: hoursBefore / 24, unit: "days" };
  }
  return { amount: hoursBefore, unit: "hours" };
}

export function formatRuleTiming(rule: Pick<NotificationRuleDraft, "amount" | "unit">): string {
  const amount = Math.max(1, Math.round(rule.amount));
  if (rule.unit === "days") {
    return `${amount} day${amount === 1 ? "" : "s"} before`;
  }
  return `${amount} hour${amount === 1 ? "" : "s"} before`;
}

interface Props {
  useDefaultNotifications: boolean;
  onUseDefaultChange: (value: boolean) => void;
  rules: NotificationRuleDraft[];
  onRulesChange: (rules: NotificationRuleDraft[]) => void;
  emailTemplates: { id: number; name: string }[];
  disabled?: boolean;
}

export function OfferingNotificationRulesEditor({
  useDefaultNotifications,
  onUseDefaultChange,
  rules,
  onRulesChange,
  emailTemplates,
  disabled = false,
}: Props) {
  const addRule = () => {
    const defaultTemplate = emailTemplates[0]?.id ?? 0;
    onRulesChange([
      ...rules,
      { email_template_id: defaultTemplate, amount: 1, unit: "days", active: true },
    ]);
  };

  const updateRule = (index: number, patch: Partial<NotificationRuleDraft>) => {
    onRulesChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (index: number) => {
    onRulesChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Schedule automated emails before each appointment. Use your own templates and timing for this event, or keep the business defaults from Settings.
      </p>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
        <input
          type="radio"
          name="offering-notification-mode"
          className="mt-1"
          checked={useDefaultNotifications}
          disabled={disabled}
          onChange={() => onUseDefaultChange(true)}
        />
        <span>
          <span className="font-medium">Use default reminders</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Same schedule as regular appointments (24 hours and 2 hours before, when enabled in Settings).
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
        <input
          type="radio"
          name="offering-notification-mode"
          className="mt-1"
          checked={!useDefaultNotifications}
          disabled={disabled}
          onChange={() => {
            onUseDefaultChange(false);
            if (rules.length === 0) addRule();
          }}
        />
        <span>
          <span className="font-medium">Custom reminders for this event</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Pick a template and how long before the appointment each email goes out.
          </span>
        </span>
      </label>

      {!useDefaultNotifications && (
        <div className="space-y-3">
          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">Add at least one reminder, or switch back to defaults.</p>
          )}
          {rules.map((rule, index) => (
            <div key={rule.id ?? `new-${index}`} className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label>Template</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  disabled={disabled}
                  value={rule.email_template_id || ""}
                  onChange={(e) => updateRule(index, { email_template_id: parseInt((e.target as HTMLSelectElement).value, 10) })}
                >
                  {emailTemplates.length === 0 ? (
                    <option value="">No templates — add them in Settings</option>
                  ) : (
                    emailTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                <div className="space-y-1.5">
                  <Label>Send</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-10"
                    disabled={disabled}
                    value={rule.amount}
                    onInput={(e) => updateRule(index, { amount: parseInt((e.target as HTMLInputElement).value, 10) || 1 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="invisible">Unit</Label>
                  <select
                    className="flex h-10 rounded-md border border-input bg-background px-3 text-sm"
                    disabled={disabled}
                    value={rule.unit}
                    onChange={(e) => updateRule(index, { unit: (e.target as HTMLSelectElement).value as NotificationRuleUnit })}
                  >
                    <option value="days">days</option>
                    <option value="hours">hours</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="invisible">Before</Label>
                  <p className="flex h-10 items-center text-sm text-muted-foreground">before appointment</p>
                </div>
                {!disabled && (
                  <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => removeRule(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{formatRuleTiming(rule)}</p>
            </div>
          ))}
          {!disabled && (
            <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={emailTemplates.length === 0}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add reminder
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
