import { useApp } from "../context";

import { CalendarDays, Clock, Users, UserCog, Sparkles, Settings, Menu, X, LogOut } from "lucide-preact";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Separator } from "@/components/ui/separator";

import { cn } from "@/lib/utils";

import { businessDisplayName } from "../../shared/branding";

import { BusinessLogo } from "./business-header";

import { api } from "../api";

import type { View } from "../types";



const navItems: { view: View; path: string; label: string; icon: typeof CalendarDays }[] = [

  { view: "calendar", path: "/calendar", label: "Calendar", icon: CalendarDays },

  { view: "clients", path: "/clients", label: "Clients", icon: Users },

  { view: "offers", path: "/offers", label: "Services", icon: Sparkles },

  { view: "appointments", path: "/appointments", label: "Appointments", icon: Clock },

  { view: "staff", path: "/staff", label: "Staff", icon: UserCog },

  { view: "settings", path: "/settings", label: "Settings", icon: Settings },

];



export function SidebarMenuButton({ onClick }: { onClick: () => void }) {

  return (

    <Button

      variant="outline"

      size="icon"

      className="fixed left-3 top-3 z-30 h-10 w-10 shadow-sm md:hidden"

      onClick={onClick}

      aria-label="Open menu"

    >

      <Menu className="h-5 w-5" />

    </Button>

  );

}



export function Sidebar({

  currentView,

  mobileOpen,

  onMobileOpenChange,

}: {

  currentView: View;

  mobileOpen: boolean;

  onMobileOpenChange: (open: boolean) => void;

}) {

  const { navigate, stats, branding } = useApp();

  const displayName = businessDisplayName(branding.business_name);



  const handleNavigate = (path: string) => {

    navigate(path);

    onMobileOpenChange(false);

  };



  return (

    <>

      {mobileOpen && (

        <button

          type="button"

          className="fixed inset-0 z-40 bg-black/50 md:hidden"

          aria-label="Close menu"

          onClick={() => onMobileOpenChange(false)}

        />

      )}

      <aside

        className={cn(

          "flex h-screen w-60 flex-col border-r bg-sidebar",

          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out md:static md:translate-x-0",

          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"

        )}

      >

      <div className="flex items-center gap-2 px-4 py-5">

        <BusinessLogo branding={branding} size="sm" />

        <span className="truncate flex-1 text-base font-semibold text-sidebar-foreground">{displayName}</span>

        <Button

          variant="ghost"

          size="icon"

          className="h-8 w-8 shrink-0 md:hidden"

          onClick={() => onMobileOpenChange(false)}

          aria-label="Close menu"

        >

          <X className="h-4 w-4" />

        </Button>

      </div>

      <Separator />

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">

        {navItems.map((item) => (

          <button

            key={item.path}

            className={cn(

              "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",

              currentView === item.view

                ? "bg-sidebar-accent text-sidebar-accent-foreground"

                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"

            )}

            onClick={() => handleNavigate(item.path)}

          >

            <item.icon className="h-4 w-4" />

            <span className="flex-1 text-left">{item.label}</span>

            {item.view === "appointments" && stats.appointments > 0 && (

              <Badge variant="secondary" className="h-5 px-1.5 text-xs">{stats.appointments}</Badge>

            )}

            {item.view === "clients" && stats.clients > 0 && (

              <Badge variant="secondary" className="h-5 px-1.5 text-xs">{stats.clients}</Badge>

            )}

          </button>

        ))}

      </nav>

      <Separator />

      <div className="px-2 pb-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-sidebar-foreground/70"
          onClick={async () => {
            await api("POST", "/api/auth/logout");
            window.location.reload();
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>

      <div className="flex items-center justify-around px-4 py-4">

        <div className="text-center">

          <div className="text-lg font-bold text-sidebar-foreground">{stats.today_appointments}</div>

          <div className="text-xs text-muted-foreground">Today</div>

        </div>

        <div className="text-center">

          <div className="text-lg font-bold text-sidebar-foreground">{stats.upcoming_appointments}</div>

          <div className="text-xs text-muted-foreground">Upcoming</div>

        </div>

      </div>

    </aside>

    </>

  );

}


