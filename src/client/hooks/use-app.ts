import { useState, useCallback, useEffect } from "preact/hooks";
import { api } from "../api";
import type {
  Appointment, Client, Staff, Service, Product, BlockedSlot, Stats, PaginatedState,
  ClientLookup, StaffLookup, OfferingSummary, OfferingSlotInstance, EventDayInfo,
} from "../types";
import type { AppContextValue } from "../context";

export function useAppState(isAgent: boolean, navigate: (to: string) => void): AppContextValue {
  const [stats, setStats] = useState<Stats>({ appointments: 0, clients: 0, staff: 0, services: 0, products: 0, today_appointments: 0, upcoming_appointments: 0, completed_appointments: 0, revenue: 0, low_stock_products: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsPag, setAppointmentsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [appointmentsSearch, setAppointmentsSearch] = useState("");
  const [appointmentsStatusFilter, setAppointmentsStatusFilter] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);

  // Calendar
  const todayStr = new Date().toISOString().split("T")[0];
  const [calendarDate, setCalendarDate] = useState(todayStr);
  const [calendarAppointments, setCalendarAppointments] = useState<Appointment[]>([]);
  const [calendarBlocked, setCalendarBlocked] = useState<BlockedSlot[]>([]);

  // Clients
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsPag, setClientsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [clientsSearch, setClientsSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedClientAppointments, setSelectedClientAppointments] = useState<Appointment[]>([]);

  // Staff, Services
  const [staffMembers, setStaffMembers] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsPag, setProductsPag] = useState<PaginatedState>({ page: 1, limit: 50, total: 0 });
  const [productsSearch, setProductsSearch] = useState("");

  // Lookups
  const [clientLookup, setClientLookup] = useState<ClientLookup[]>([]);
  const [staffLookup, setStaffLookup] = useState<StaffLookup[]>([]);

  const [defaultCurrency, setDefaultCurrency] = useState("USD");
  const [currencyOptions, setCurrencyOptions] = useState<{ value: string; label: string }[]>([]);
  const [businessLocale, setBusinessLocale] = useState({
    country: "LC",
    timezone: "America/St_Lucia",
    utc_offset_hours: -4,
    utc_offset_label: "UTC−4",
  });
  const [localeCountryOptions, setLocaleCountryOptions] = useState<{ value: string; label: string }[]>([]);
  const [localeTimezoneOptions, setLocaleTimezoneOptions] = useState<{ value: string; label: string }[]>([]);
  const [branding, setBranding] = useState({ business_name: "", business_tagline: "", logo_url: "" });
  const [offerings, setOfferings] = useState<OfferingSummary[]>([]);
  const [calendarOfferingSlots, setCalendarOfferingSlots] = useState<OfferingSlotInstance[]>([]);
  const [calendarEventDay, setCalendarEventDay] = useState<EventDayInfo>({
    is_event_day: false,
    block_regular_bookings: false,
    event_names: [],
  });
  const [blockRegularOnEventDays, setBlockRegularOnEventDays] = useState(true);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [stripeWebhookConfigured, setStripeWebhookConfigured] = useState(false);
  const [stripePaymentsEnabled, setStripePaymentsEnabled] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState({
    email_enabled: true,
    sms_enabled: false,
    whatsapp_enabled: false,
    email_reply_to: "",
    email_configured: false,
    remind_24h_enabled: true,
    remind_2h_enabled: true,
  });
  const [emailDomain, setEmailDomain] = useState({
    resend_configured: false,
    domain: "",
    domain_id: "",
    status: "",
    from_address: "",
    records: [] as { record: string; name: string; type: string; value: string; priority?: number; status?: string }[],
    can_send_from_domain: false,
  });

  const fetchCurrencySettings = useCallback(async () => {
    const data = await api<{ default_currency: string; supported: { value: string; label: string }[] }>(
      "GET",
      "/api/settings/currency",
    );
    setDefaultCurrency(data.default_currency);
    setCurrencyOptions(data.supported);
  }, []);

  const fetchLocaleSettings = useCallback(async () => {
    const data = await api<{
      country: string;
      timezone: string;
      utc_offset_hours: number;
      utc_offset_label: string;
      countries: { value: string; label: string }[];
      timezones: { value: string; label: string }[];
    }>("GET", "/api/settings/locale");
    setBusinessLocale({
      country: data.country,
      timezone: data.timezone,
      utc_offset_hours: data.utc_offset_hours,
      utc_offset_label: data.utc_offset_label,
    });
    setLocaleCountryOptions(data.countries);
    setLocaleTimezoneOptions(data.timezones);
  }, []);

  const updateBusinessLocale = useCallback(async (country: string, timezone: string) => {
    const res = await api<{
      country: string;
      timezone: string;
      utc_offset_hours: number;
      utc_offset_label: string;
    }>("PUT", "/api/settings/locale", { country, timezone });
    setBusinessLocale(res);
    const refreshed = await api<{
      country: string;
      timezone: string;
      utc_offset_hours: number;
      utc_offset_label: string;
      countries: { value: string; label: string }[];
      timezones: { value: string; label: string }[];
    }>("GET", "/api/settings/locale");
    setLocaleCountryOptions(refreshed.countries);
    setLocaleTimezoneOptions(refreshed.timezones);
  }, []);

  const fetchBranding = useCallback(async () => {
    const data = await api<{ business_name: string; business_tagline: string; logo_url: string }>(
      "GET",
      "/api/settings/branding",
    );
    setBranding(data);
  }, []);

  const updateBranding = useCallback(async (data: {
    business_name: string;
    business_tagline?: string;
    logo_url?: string | null;
  }) => {
    const res = await api<{ business_name: string; business_tagline: string; logo_url: string }>(
      "PUT",
      "/api/settings/branding",
      data,
    );
    setBranding(res);
  }, []);

  const uploadBrandingLogo = useCallback(async (logoDataUrl: string) => {
    const res = await api<{ business_name: string; business_tagline: string; logo_url: string }>(
      "POST",
      "/api/settings/branding/logo",
      { logo_data_url: logoDataUrl },
    );
    setBranding(res);
  }, []);

  const fetchStats = useCallback(async () => {
    const data = await api<Stats>("GET", "/api/stats");
    setStats(data);
  }, []);

  const fetchAppointments = useCallback(async (pag: PaginatedState, search: string, status: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    const data = await api<{ appointments: Appointment[]; total: number }>("GET", `/api/appointments?${params}`);
    setAppointments(data.appointments);
    setAppointmentsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchCalendar = useCallback(async (date: string) => {
    const data = await api<{
      appointments: Appointment[];
      blocked_slots: BlockedSlot[];
      event_day: EventDayInfo;
    }>("GET", `/api/calendar?start=${date}&end=${date}`);
    setCalendarAppointments(data.appointments);
    setCalendarBlocked(data.blocked_slots);
    setCalendarEventDay(data.event_day ?? {
      is_event_day: false,
      block_regular_bookings: false,
      event_names: [],
    });
    const slotsData = await api<{ slots: OfferingSlotInstance[] }>("GET", `/api/offerings/calendar?start=${date}&end=${date}`);
    setCalendarOfferingSlots(slotsData.slots);
  }, []);

  const fetchOfferings = useCallback(async () => {
    const data = await api<{ offerings: OfferingSummary[] }>("GET", "/api/offerings");
    setOfferings(data.offerings);
  }, []);

  const createOffering = useCallback(async (payload: Record<string, unknown>): Promise<number> => {
    const res = await api<{ offering: { id: number } }>("POST", "/api/offerings", payload);
    await fetchOfferings();
    return res.offering.id;
  }, [fetchOfferings]);

  const updateOffering = useCallback(async (id: number, payload: Record<string, unknown>) => {
    await api("PUT", `/api/offerings/${id}`, payload);
    await fetchOfferings();
  }, [fetchOfferings]);

  const goLiveOffering = useCallback(async (id: number) => {
    const res = await api<{ conflicts?: { id: number; identifier: string; scheduled_date: string; start_time: string; client_name: string }[] }>(
      "POST",
      `/api/offerings/${id}/go-live`,
    );
    await fetchOfferings();
    await fetchCalendar(calendarDate);
    return res.conflicts ?? [];
  }, [fetchOfferings, fetchCalendar, calendarDate]);

  const duplicateOffering = useCallback(async (id: number): Promise<number> => {
    const res = await api<{ offering: { id: number } }>("POST", `/api/offerings/${id}/duplicate`);
    await fetchOfferings();
    return res.offering.id;
  }, [fetchOfferings]);

  const archiveOffering = useCallback(async (id: number) => {
    await api("POST", `/api/offerings/${id}/archive`);
    await fetchOfferings();
    await fetchCalendar(calendarDate);
  }, [fetchOfferings, fetchCalendar, calendarDate]);

  const deleteOffering = useCallback(async (id: number) => {
    await api("DELETE", `/api/offerings/${id}`);
    await fetchOfferings();
    await fetchCalendar(calendarDate);
  }, [fetchOfferings, fetchCalendar, calendarDate]);

  const fetchEventOverrideSettings = useCallback(async () => {
    const data = await api<{ block_regular_on_event_days: boolean }>("GET", "/api/settings/event-override");
    setBlockRegularOnEventDays(data.block_regular_on_event_days);
  }, []);

  const fetchStripeSettings = useCallback(async () => {
    const data = await api<{
      configured: boolean;
      webhook_configured: boolean;
      payments_enabled: boolean;
    }>("GET", "/api/settings/stripe");
    setStripeConfigured(data.configured);
    setStripeWebhookConfigured(data.webhook_configured);
    setStripePaymentsEnabled(data.payments_enabled);
  }, []);

  const updateStripePaymentsEnabled = useCallback(async (enabled: boolean) => {
    const res = await api<{
      configured: boolean;
      webhook_configured: boolean;
      payments_enabled: boolean;
    }>("PUT", "/api/settings/stripe", { payments_enabled: enabled });
    setStripeConfigured(res.configured);
    setStripeWebhookConfigured(res.webhook_configured);
    setStripePaymentsEnabled(res.payments_enabled);
  }, []);

  const fetchNotificationSettings = useCallback(async () => {
    const data = await api<{
      email_enabled: boolean;
      sms_enabled: boolean;
      whatsapp_enabled: boolean;
      email_reply_to: string;
      email_configured: boolean;
      remind_24h_enabled: boolean;
      remind_2h_enabled: boolean;
    }>("GET", "/api/settings/notifications");
    setNotificationSettings(data);
  }, []);

  const updateNotificationSettings = useCallback(async (data: {
    email_enabled?: boolean;
    sms_enabled?: boolean;
    whatsapp_enabled?: boolean;
    email_reply_to?: string;
    remind_24h_enabled?: boolean;
    remind_2h_enabled?: boolean;
  }) => {
    const res = await api<{
      email_enabled: boolean;
      sms_enabled: boolean;
      whatsapp_enabled: boolean;
      email_reply_to: string;
      email_configured: boolean;
      remind_24h_enabled: boolean;
      remind_2h_enabled: boolean;
    }>("PUT", "/api/settings/notifications", data);
    setNotificationSettings(res);
  }, []);

  const fetchEmailDomain = useCallback(async () => {
    const data = await api<{
      resend_configured: boolean;
      domain: string;
      domain_id: string;
      status: string;
      from_address: string;
      records: { record: string; name: string; type: string; value: string; priority?: number; status?: string }[];
      can_send_from_domain: boolean;
    }>("GET", "/api/settings/email-domain");
    setEmailDomain(data);
  }, []);

  const connectEmailDomain = useCallback(async (domain: string) => {
    const data = await api<typeof emailDomain>("POST", "/api/settings/email-domain", { domain });
    setEmailDomain(data);
  }, []);

  const verifyEmailDomain = useCallback(async () => {
    const data = await api<typeof emailDomain>("POST", "/api/settings/email-domain/verify");
    setEmailDomain(data);
  }, []);

  const refreshEmailDomain = useCallback(async () => {
    const data = await api<typeof emailDomain>("POST", "/api/settings/email-domain/refresh");
    setEmailDomain(data);
  }, []);

  const setEmailFromAddress = useCallback(async (fromAddress: string) => {
    const data = await api<typeof emailDomain>("PUT", "/api/settings/email-domain/from", { from_address: fromAddress });
    setEmailDomain(data);
  }, []);

  const updateBlockRegularOnEventDays = useCallback(async (enabled: boolean) => {
    const res = await api<{ block_regular_on_event_days: boolean }>(
      "PUT",
      "/api/settings/event-override",
      { block_regular_on_event_days: enabled },
    );
    setBlockRegularOnEventDays(res.block_regular_on_event_days);
  }, []);

  const bookOfferingSlot = useCallback(async (slotId: number, data: {
    client_id: number;
    staff_id?: number | null;
    addon_ids?: number[];
    notes?: string;
  }) => {
    await api("POST", `/api/offerings/slots/${slotId}/book`, data);
    await fetchCalendar(calendarDate);
    await fetchStats();
  }, [fetchCalendar, calendarDate, fetchStats]);

  const fetchClients = useCallback(async (pag: PaginatedState, search: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    const data = await api<{ clients: Client[]; total: number }>("GET", `/api/clients?${params}`);
    setClients(data.clients);
    setClientsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchStaff = useCallback(async () => {
    const data = await api<{ staff: Staff[] }>("GET", "/api/staff");
    setStaffMembers(data.staff);
  }, []);

  const fetchServices = useCallback(async () => {
    const data = await api<{ services: Service[] }>("GET", "/api/services");
    setServices(data.services);
  }, []);

  const fetchProducts = useCallback(async (pag: PaginatedState, search: string) => {
    const params = new URLSearchParams({ page: String(pag.page), limit: String(pag.limit) });
    if (search) params.set("search", search);
    const data = await api<{ products: Product[]; total: number }>("GET", `/api/products?${params}`);
    setProducts(data.products);
    setProductsPag((prev) => ({ ...prev, total: data.total }));
  }, []);

  const fetchLookups = useCallback(async () => {
    const [c, s] = await Promise.all([
      api<{ clients: ClientLookup[] }>("GET", "/api/clients/all"),
      api<{ staff: StaffLookup[] }>("GET", "/api/staff/all"),
    ]);
    setClientLookup(c.clients);
    setStaffLookup(s.staff);
  }, []);

  // ── Initial load ──

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([
          fetchStats(),
          fetchAppointments(appointmentsPag, "", ""),
          fetchCalendar(calendarDate),
          fetchClients(clientsPag, ""),
          fetchStaff(),
          fetchServices(),
          fetchProducts(productsPag, ""),
          fetchLookups(),
          fetchCurrencySettings(),
          fetchLocaleSettings(),
          fetchBranding(),
          fetchOfferings(),
          fetchEventOverrideSettings(),
          fetchStripeSettings(),
          fetchNotificationSettings(),
          fetchEmailDomain(),
        ]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter).catch((err) => setError((err as Error).message));
  }, [appointmentsPag.page, appointmentsSearch, appointmentsStatusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCalendar(calendarDate).catch((err) => setError((err as Error).message));
  }, [calendarDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchClients(clientsPag, clientsSearch).catch((err) => setError((err as Error).message));
  }, [clientsPag.page, clientsSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchProducts(productsPag, productsSearch).catch((err) => setError((err as Error).message));
  }, [productsPag.page, productsSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Appointments CRUD ──

  const setAppointmentsPage = useCallback((page: number) => setAppointmentsPag((p) => ({ ...p, page })), []);

  const addAppointment = useCallback(async (data: {
    client_id: number; staff_id?: number | null; scheduled_date: string;
    start_time?: string; notes?: string; is_recurring?: number; recurrence_interval?: string;
    service_ids?: number[]; travel_fee?: number; service_address?: string;
  }) => {
    await api("POST", "/api/appointments", data);
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, calendarDate, fetchAppointments, fetchStats, fetchCalendar]);

  const createBookingLink = useCallback(async (data: {
    staff_id: number;
    scheduled_date: string;
    start_time: string;
    duration_minutes?: number;
    total_price?: number;
    deposit_amount?: number;
    travel_fee?: number;
    currency?: string;
    notes?: string;
    service_ids?: number[];
  }): Promise<string> => {
    const res = await api<{ booking_link: { token: string }; url_path: string }>("POST", "/api/booking-links", data);
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
    return `${window.location.origin}${res.url_path}`;
  }, [calendarDate, fetchStats, fetchCalendar]);

  const updateDefaultCurrency = useCallback(async (code: string) => {
    const res = await api<{ default_currency: string }>("PUT", "/api/settings/currency", { default_currency: code });
    setDefaultCurrency(res.default_currency);
  }, []);

  const updateAppointment = useCallback(async (id: number, data: Partial<Appointment>) => {
    await api("PUT", `/api/appointments/${id}`, data);
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    if (selectedAppointment && selectedAppointment.id === id) {
      const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`);
      setSelectedAppointment(res.appointment);
    }
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedAppointment, calendarDate, fetchAppointments, fetchStats, fetchCalendar]);

  const updateAppointmentAddons = useCallback(async (id: number, addonIds: number[]) => {
    await api("PUT", `/api/appointments/${id}/addons`, { addon_ids: addonIds });
    await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
    if (selectedAppointment && selectedAppointment.id === id) {
      const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`);
      setSelectedAppointment(res.appointment);
    }
    await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedAppointment, calendarDate, fetchAppointments, fetchStats, fetchCalendar]);

  const deleteAppointment = useCallback(async (id: number) => {
    if (!confirm("Delete this appointment? This cannot be undone.")) return;
    try {
      setError(null);
      await api("DELETE", `/api/appointments/${id}`);
      if (selectedAppointment && selectedAppointment.id === id) { setSelectedAppointment(null); navigate("/appointments"); }
      await fetchAppointments(appointmentsPag, appointmentsSearch, appointmentsStatusFilter);
      await Promise.all([fetchStats(), fetchCalendar(calendarDate)]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [appointmentsPag, appointmentsSearch, appointmentsStatusFilter, selectedAppointment, calendarDate, navigate, fetchAppointments, fetchStats, fetchCalendar]);

  const selectAppointment = useCallback(async (id: number | null) => {
    if (id === null) { setSelectedAppointment(null); return; }
    const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`);
    setSelectedAppointment(res.appointment);
  }, []);

  const addAppointmentNote = useCallback(async (aptId: number, content: string) => {
    await api("POST", `/api/appointments/${aptId}/notes`, { content });
    const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${aptId}`);
    setSelectedAppointment(res.appointment);
  }, []);

  const deleteAppointmentNote = useCallback(async (noteId: number) => {
    await api("DELETE", `/api/notes/${noteId}`);
    if (selectedAppointment) {
      const res = await api<{ appointment: Appointment }>("GET", `/api/appointments/${selectedAppointment.id}`);
      setSelectedAppointment(res.appointment);
    }
  }, [selectedAppointment]);

  const sendAppointmentPaymentLink = useCallback(async (id: number) => {
    const res = await api<{
      checkout_url: string;
      session_id: string;
      amount: number;
      currency: string;
    }>("POST", `/api/appointments/${id}/payment-link`);
    if (selectedAppointment && selectedAppointment.id === id) {
      const aptRes = await api<{ appointment: Appointment }>("GET", `/api/appointments/${id}`);
      setSelectedAppointment(aptRes.appointment);
    }
    return res;
  }, [selectedAppointment]);

  // ── Calendar / Blocked Slots ──

  const addBlockedSlot = useCallback(async (data: { staff_id: number; blocked_date: string; start_time: string; end_time: string; reason?: string }) => {
    await api("POST", "/api/blocked-slots", data);
    await fetchCalendar(calendarDate);
  }, [calendarDate, fetchCalendar]);

  const deleteBlockedSlot = useCallback(async (id: number) => {
    await api("DELETE", `/api/blocked-slots/${id}`);
    await fetchCalendar(calendarDate);
  }, [calendarDate, fetchCalendar]);

  // ── Clients CRUD ──

  const setClientsPage = useCallback((page: number) => setClientsPag((p) => ({ ...p, page })), []);

  const addClient = useCallback(async (data: Partial<Client>): Promise<Client> => {
    const res = await api<{ client: Client }>("POST", "/api/clients", data);
    await fetchClients(clientsPag, clientsSearch);
    await Promise.all([fetchStats(), fetchLookups()]);
    return res.client;
  }, [clientsPag, clientsSearch, fetchClients, fetchStats, fetchLookups]);

  const updateClient = useCallback(async (id: number, data: Partial<Client>) => {
    await api("PUT", `/api/clients/${id}`, data);
    await fetchClients(clientsPag, clientsSearch);
    await fetchLookups();
    if (selectedClient && selectedClient.id === id) {
      const res = await api<{ client: Client; appointments: Appointment[] }>("GET", `/api/clients/${id}`);
      setSelectedClient(res.client);
      setSelectedClientAppointments(res.appointments);
    }
  }, [clientsPag, clientsSearch, selectedClient, fetchClients, fetchLookups]);

  const deleteClient = useCallback(async (id: number) => {
    const client = selectedClient?.id === id ? selectedClient : clients.find((c) => c.id === id);
    const label = client?.name || "This client";
    if ((client?.active_booking_count ?? 0) > 0) {
      setError(`${label} has active or upcoming bookings. Delete or cancel those appointments first.`);
      return;
    }
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      setError(null);
      await api("DELETE", `/api/clients/${id}`);
      if (selectedClient && selectedClient.id === id) {
        setSelectedClient(null);
        setSelectedClientAppointments([]);
        navigate("/clients");
      }
      await fetchClients(clientsPag, clientsSearch);
      await Promise.all([fetchStats(), fetchLookups()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [clients, clientsPag, clientsSearch, selectedClient, navigate, fetchClients, fetchStats, fetchLookups]);

  const selectClient = useCallback(async (id: number | null) => {
    if (id === null) { setSelectedClient(null); setSelectedClientAppointments([]); return; }
    const res = await api<{ client: Client; appointments: Appointment[] }>("GET", `/api/clients/${id}`);
    setSelectedClient(res.client);
    setSelectedClientAppointments(res.appointments);
  }, []);

  // ── Staff CRUD ──

  const addStaff = useCallback(async (data: Partial<Staff>) => {
    await api("POST", "/api/staff", data);
    await fetchStaff();
    await Promise.all([fetchStats(), fetchLookups()]);
  }, [fetchStaff, fetchStats, fetchLookups]);

  const updateStaff = useCallback(async (id: number, data: Partial<Staff>) => {
    await api("PUT", `/api/staff/${id}`, data);
    await fetchStaff();
    await fetchLookups();
  }, [fetchStaff, fetchLookups]);

  const deleteStaff = useCallback(async (id: number) => {
    const staff = staffMembers.find((s) => s.id === id);
    const label = staff?.name || "This staff member";
    if (staff?.is_admin && staffMembers.filter((s) => s.is_admin).length === 1) {
      setError(`${label} is the only admin. Assign another admin before deleting them.`);
      return;
    }
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      setError(null);
      await api("DELETE", `/api/staff/${id}`);
      await fetchStaff();
      await Promise.all([fetchStats(), fetchLookups()]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [staffMembers, fetchStaff, fetchStats, fetchLookups]);

  // ── Services CRUD ──

  const addService = useCallback(async (data: Partial<Service>) => {
    await api("POST", "/api/services", data);
    await fetchServices();
    await fetchStats();
  }, [fetchServices, fetchStats]);

  const updateService = useCallback(async (id: number, data: Partial<Service>) => {
    await api("PUT", `/api/services/${id}`, data);
    await fetchServices();
  }, [fetchServices]);

  const deleteService = useCallback(async (id: number) => {
    await api("DELETE", `/api/services/${id}`);
    await fetchServices();
    await fetchStats();
  }, [fetchServices, fetchStats]);

  // ── Products CRUD ──

  const setProductsPage = useCallback((page: number) => setProductsPag((p) => ({ ...p, page })), []);

  const addProduct = useCallback(async (data: Partial<Product>) => {
    await api("POST", "/api/products", data);
    await fetchProducts(productsPag, productsSearch);
    await fetchStats();
  }, [productsPag, productsSearch, fetchProducts, fetchStats]);

  const updateProduct = useCallback(async (id: number, data: Partial<Product>) => {
    await api("PUT", `/api/products/${id}`, data);
    await fetchProducts(productsPag, productsSearch);
  }, [productsPag, productsSearch, fetchProducts]);

  const deleteProduct = useCallback(async (id: number) => {
    await api("DELETE", `/api/products/${id}`);
    await fetchProducts(productsPag, productsSearch);
    await fetchStats();
  }, [productsPag, productsSearch, fetchProducts, fetchStats]);

  return {
    navigate, isAgent, stats,
    appointments, appointmentsPag, setAppointmentsPage, appointmentsSearch, setAppointmentsSearch,
    appointmentsStatusFilter, setAppointmentsStatusFilter,
    addAppointment, createBookingLink, updateAppointment, updateAppointmentAddons, deleteAppointment,
    selectedAppointment, selectAppointment, addAppointmentNote, deleteAppointmentNote, sendAppointmentPaymentLink,
    calendarAppointments, calendarBlocked, calendarEventDay, calendarDate, setCalendarDate,
    addBlockedSlot, deleteBlockedSlot,
    clients, clientsPag, setClientsPage, clientsSearch, setClientsSearch,
    addClient, updateClient, deleteClient,
    selectedClient, selectedClientAppointments, selectClient,
    staffMembers, addStaff, updateStaff, deleteStaff,
    services, addService, updateService, deleteService,
    products, productsPag, setProductsPage, productsSearch, setProductsSearch,
    addProduct, updateProduct, deleteProduct,
    clientLookup, staffLookup,
    defaultCurrency, currencyOptions, updateDefaultCurrency,
    businessLocale, localeCountryOptions, localeTimezoneOptions, updateBusinessLocale,
    blockRegularOnEventDays, updateBlockRegularOnEventDays,
    stripeConfigured, stripeWebhookConfigured, stripePaymentsEnabled, updateStripePaymentsEnabled,
    notificationSettings, updateNotificationSettings,
    emailDomain, connectEmailDomain, verifyEmailDomain, refreshEmailDomain, setEmailFromAddress,
    branding, updateBranding, uploadBrandingLogo,
    offerings, calendarOfferingSlots, fetchOfferings,
    createOffering, updateOffering, goLiveOffering, duplicateOffering, archiveOffering, deleteOffering, bookOfferingSlot,
    loading, error, setError,
  };
}
