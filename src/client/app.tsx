import { useEffect, useMemo, useState } from "preact/hooks";

import { AppContext } from "./context";

import { useAppState } from "./hooks/use-app";

import { useRouter } from "./hooks/use-router";

import { Sidebar } from "./components/sidebar";

import { CalendarView } from "./components/calendar-view";

import { AppointmentList } from "./components/appointment-list";

import { AppointmentDetail } from "./components/appointment-detail";

import { ClientList } from "./components/client-list";

import { ClientDetail } from "./components/client-detail";

import { StaffList } from "./components/staff-list";

import { ProductList } from "./components/product-list";

import { SettingsPage } from "./components/settings-page";

import { WhatIOfferList } from "./components/what-i-offer-list";

import { WhatIOfferTypePicker } from "./components/what-i-offer-type-picker";

import { AnytimeOfferForm } from "./components/anytime-offer-form";

import { EventOfferWizard } from "./components/offering-wizard";

import { ErrorBanner } from "./components/error-banner";

import { businessDisplayName } from "../shared/branding";



export function App() {

  const isAgent = useMemo(() => {

    const params = new URLSearchParams(window.location.search);

    return params.has("agent") || params.get("mode") === "agent";

  }, []);



  useEffect(() => {

    if (isAgent) {

      document.documentElement.setAttribute("data-agent", "");

    }

  }, [isAgent]);



  const { view, id, sub, navigate } = useRouter();

  const appState = useAppState(isAgent, navigate);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);



  useEffect(() => {

    if (view === "appointments" && id) {

      appState.selectAppointment(parseInt(id, 10));

    } else if (view === "clients" && id) {

      appState.selectClient(parseInt(id, 10));

    }

  }, [view, id]); // eslint-disable-line react-hooks/exhaustive-deps



  useEffect(() => {

    setMobileMenuOpen(false);

  }, [view, id, sub]);



  useEffect(() => {

    document.title = businessDisplayName(appState.branding.business_name);

  }, [appState.branding.business_name]);



  const renderMain = () => {

    if (view === "appointments" && id && appState.selectedAppointment) return <AppointmentDetail />;

    if (view === "clients" && id && appState.selectedClient) return <ClientDetail />;

    switch (view) {

      case "calendar": return <CalendarView />;

      case "appointments": return <AppointmentList />;

      case "clients": return <ClientList />;

      case "staff": return <StaffList />;

      case "offers":

        if (id === "add" && sub === "anytime") return <AnytimeOfferForm />;

        if (id === "add" && sub === "event") return <EventOfferWizard />;

        if (id === "add") return <WhatIOfferTypePicker />;

        if (id === "anytime" && sub) return <AnytimeOfferForm serviceId={parseInt(sub, 10)} />;

        if (id === "event" && sub) return <EventOfferWizard offeringId={parseInt(sub, 10)} />;

        if (id === "new") return <WhatIOfferTypePicker />;

        if (id && /^\d+$/.test(id)) return <EventOfferWizard offeringId={parseInt(id, 10)} />;

        return <WhatIOfferList />;

      case "settings": return <SettingsPage />;

      case "products": return <ProductList />;

      default: return <CalendarView />;

    }

  };



  return (

    <AppContext.Provider value={{ ...appState, openMobileMenu: () => setMobileMenuOpen(true) }}>

      <div className="flex h-screen overflow-hidden">

        <Sidebar

          currentView={view}

          mobileOpen={mobileMenuOpen}

          onMobileOpenChange={setMobileMenuOpen}

        />

        <main className="flex-1 overflow-y-auto bg-background">

          {appState.loading ? (

            <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>

          ) : (

            renderMain()

          )}

        </main>

      </div>

      <ErrorBanner />

    </AppContext.Provider>

  );

}


