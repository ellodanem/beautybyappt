import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-preact";
import { TemplateTestSend } from "./template-test-send";

type TemplateRow = {
  id: number;
  slug: string;
  name: string;
  subject: string;
  body: string;
  is_builtin: boolean;
};

function TemplateEditor({
  template,
  placeholders,
  onSave,
  onDelete,
  saving,
}: {
  template: TemplateRow;
  placeholders: string[];
  onSave: (data: { name?: string; subject: string; body: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [saved, setSaved] = useState(false);

  const dirty = name !== template.name || subject !== template.subject || body !== template.body;

  const handleSave = async () => {
    await onSave({
      name: template.is_builtin ? undefined : name,
      subject,
      body,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="font-medium">{template.name}</span>
        <span className="flex items-center gap-2">
          {template.is_builtin && (
            <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Built-in
            </span>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </span>
      </button>
      {expanded && (
        <div className="space-y-4 border-t px-4 py-4">
          {!template.is_builtin && (
            <div className="space-y-1.5">
              <Label htmlFor={`template-name-${template.id}`}>Name</Label>
              <Input
                id={`template-name-${template.id}`}
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`template-subject-${template.id}`}>Subject</Label>
            <Input
              id={`template-subject-${template.id}`}
              value={subject}
              onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`template-body-${template.id}`}>Body</Label>
            <textarea
              id={`template-body-${template.id}`}
              className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={body}
              onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Placeholders: {placeholders.join(", ")}
          </p>
          <TemplateTestSend templateId={template.id} subject={subject} body={body} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save template"}
            </Button>
            {!template.is_builtin && onDelete && (
              <Button size="sm" variant="destructive" disabled={saving} onClick={onDelete}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete
              </Button>
            )}
            {saved && !dirty && <span className="text-sm text-emerald-600">Saved</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export function EmailTemplatesSettings() {
  const {
    emailTemplates,
    emailTemplatePlaceholders,
    createEmailTemplate,
    updateEmailTemplate,
    deleteEmailTemplate,
    setError,
  } = useApp();

  const [savingId, setSavingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newBody, setNewBody] = useState("");

  const handleCreate = async () => {
    if (!newName.trim() || !newSubject.trim() || !newBody.trim()) return;
    setCreating(true);
    try {
      await createEmailTemplate({
        name: newName.trim(),
        subject: newSubject.trim(),
        body: newBody.trim(),
      });
      setNewName("");
      setNewSubject("");
      setNewBody("");
      setShowNew(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="text-base">Email templates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Prewritten emails you can send from an appointment — including payment reminders. Edit the built-in template or add your own.
        </p>
        <div className="space-y-3">
          {emailTemplates.map((template) => (
            <TemplateEditor
              key={template.id}
              template={template}
              placeholders={emailTemplatePlaceholders}
              saving={savingId === template.id}
              onSave={async (data) => {
                setSavingId(template.id);
                try {
                  await updateEmailTemplate(template.id, data);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setSavingId(null);
                }
              }}
              onDelete={template.is_builtin ? undefined : async () => {
                setSavingId(template.id);
                try {
                  await deleteEmailTemplate(template.id);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setSavingId(null);
                }
              }}
            />
          ))}
        </div>
        {showNew ? (
          <div className="space-y-4 rounded-lg border p-4">
            <p className="font-medium">New template</p>
            <div className="space-y-1.5">
              <Label htmlFor="new-template-name">Name</Label>
              <Input
                id="new-template-name"
                value={newName}
                onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
                placeholder="Follow-up after appointment"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-template-subject">Subject</Label>
              <Input
                id="new-template-subject"
                value={newSubject}
                onInput={(e) => setNewSubject((e.target as HTMLInputElement).value)}
                placeholder="Thank you — {reference}"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-template-body">Body</Label>
              <textarea
                id="new-template-body"
                className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newBody}
                onInput={(e) => setNewBody((e.target as HTMLTextAreaElement).value)}
                placeholder={"Hi {client_name},\n\n..."}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Placeholders: {emailTemplatePlaceholders.join(", ")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={creating || !newName.trim() || !newSubject.trim() || !newBody.trim()} onClick={handleCreate}>
                {creating ? "Creating…" : "Create template"}
              </Button>
              <Button size="sm" variant="outline" disabled={creating} onClick={() => setShowNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add custom template
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
