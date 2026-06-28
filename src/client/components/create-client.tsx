import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { Client } from "../types";
import { parseRequiredBookingEmail } from "../../shared/email";

export function CreateClient({ onClose, onCreated }: { onClose: () => void; onCreated?: (client: Client) => void }) {
  const { addClient, setError } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    const emailCheck = parseRequiredBookingEmail(email);
    if (!emailCheck.ok) { setError(emailCheck.error); return; }
    setSaving(true);
    try {
      const client = await addClient({ name: name.trim(), email: emailCheck.email, phone, notes });
      onCreated?.(client);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Client</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone((e.target as HTMLInputElement).value)} placeholder="555-0100" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder="Preferences, allergies, etc." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleSubmit}>{saving ? "Saving..." : "Add Client"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
