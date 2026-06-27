import { useState } from "preact/hooks";
import { useApp } from "../context";
import { Plus, Search, Trash2, Mail, Phone } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "./pagination";
import { CreateClient } from "./create-client";
import { MobileNavTrigger } from "./mobile-nav-trigger";
import type { Client } from "../types";

function ClientMobileCard({
  client,
  onOpen,
  onDelete,
}: {
  client: Client;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const visits = client.appointment_count || 0;
  const hasActiveBookings = (client.active_booking_count ?? 0) > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-lg border bg-card p-4 transition-colors active:bg-muted/50"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <p className="mb-2 font-semibold leading-tight">{client.name}</p>
      {client.email ? (
        <a
          href={`mailto:${client.email}`}
          className="mb-1.5 flex items-start gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <Mail className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-all">{client.email}</span>
        </a>
      ) : (
        <p className="mb-1.5 text-sm text-muted-foreground">No email</p>
      )}
      {client.phone ? (
        <a
          href={`tel:${client.phone}`}
          className="mb-3 flex items-center gap-2 text-sm hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{client.phone}</span>
        </a>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">No phone</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="font-normal">
          {visits} visit{visits === 1 ? "" : "s"}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-40"
          disabled={hasActiveBookings}
          title={hasActiveBookings ? "Delete or cancel active bookings first" : "Delete client"}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete client"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ClientList() {
  const { clients, clientsPag, setClientsPage, clientsSearch, setClientsSearch, deleteClient, navigate } = useApp();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4 p-4 pb-8 md:p-6">
      <div className="flex items-center gap-2">
        <MobileNavTrigger />
        <h1 className="min-w-0 flex-1 text-xl font-bold tracking-tight md:text-2xl">Clients</h1>
        <Button size="sm" className="shrink-0" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 md:mr-1" />
          <span className="hidden sm:inline">Add Client</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </div>

      {showCreate && <CreateClient onClose={() => setShowCreate(false)} />}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search clients..." value={clientsSearch} onInput={(e) => setClientsSearch((e.target as HTMLInputElement).value)} />
      </div>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No clients found
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {clients.map((c) => (
              <ClientMobileCard
                key={c.id}
                client={c}
                onOpen={() => navigate(`/clients/${c.id}`)}
                onDelete={() => deleteClient(c.id)}
              />
            ))}
          </div>

          <Card className="hidden md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-44">Email</TableHead>
                    <TableHead className="w-28">Phone</TableHead>
                    <TableHead className="w-24 text-center">Visits</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/clients/${c.id}`)}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.email || "—"}</TableCell>
                      <TableCell className="text-sm">{c.phone || "—"}</TableCell>
                      <TableCell className="text-center">{c.appointment_count || 0}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          disabled={(c.active_booking_count ?? 0) > 0}
                          title={(c.active_booking_count ?? 0) > 0 ? "Delete or cancel active bookings first" : "Delete client"}
                          onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <Pagination pag={clientsPag} setPage={setClientsPage} />
    </div>
  );
}
