import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type {
  Appointment, Client, Staff, Service, Product, BlockedSlot, Stats, PaginatedState,
  ClientLookup, StaffLookup, OfferingSummary, OfferingSlotInstance, EventDayInfo, AppointmentConflict,
} from "./types";

export interface AppContextValue {
  navigate: (to: string) => void;
  isAgent: boolean;
  stats: Stats;

  // Appointments
  appointments: Appointment[];
  appointmentsPag: PaginatedState;
  setAppointmentsPage: (page: number) => void;
  appointmentsSearch: string;
  setAppointmentsSearch: (s: string) => void;
  appointmentsStatusFilter: string;
  setAppointmentsStatusFilter: (s: string) => void;
  addAppointment: (data: {
    client_id: number;
    staff_id?: number | null;
    scheduled_date: string;
    start_time?: string;
    notes?: string;
    is_recurring?: number;
    recurrence_interval?: string;
    service_ids?: number[];
    travel_fee?: number;
    service_address?: string;
  }) => Promise<void>;
  createBookingLink: (data: {
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
  }) => Promise<string>;

  stripeConfigured: boolean;
  stripeWebhookConfigured: boolean;
  stripePaymentsEnabled: boolean;
  updateStripePaymentsEnabled: (enabled: boolean) => Promise<void>;

  notificationSettings: {
    email_enabled: boolean;
    sms_enabled: boolean;
    whatsapp_enabled: boolean;
    email_reply_to: string;
    email_configured: boolean;
    remind_24h_enabled: boolean;
    remind_2h_enabled: boolean;
  };
  updateNotificationSettings: (data: {
    email_enabled?: boolean;
    sms_enabled?: boolean;
    whatsapp_enabled?: boolean;
    email_reply_to?: string;
    remind_24h_enabled?: boolean;
    remind_2h_enabled?: boolean;
  }) => Promise<void>;

  emailDomain: {
    resend_configured: boolean;
    domain: string;
    domain_id: string;
    status: string;
    from_address: string;
    records: { record: string; name: string; type: string; value: string; priority?: number; status?: string }[];
    can_send_from_domain: boolean;
  };
  connectEmailDomain: (domain: string) => Promise<void>;
  verifyEmailDomain: () => Promise<void>;
  refreshEmailDomain: () => Promise<void>;
  setEmailFromAddress: (fromAddress: string) => Promise<void>;

  defaultCurrency: string;
  currencyOptions: { value: string; label: string }[];
  updateDefaultCurrency: (code: string) => Promise<void>;

  businessLocale: {
    country: string;
    timezone: string;
    utc_offset_hours: number;
    utc_offset_label: string;
  };
  localeCountryOptions: { value: string; label: string }[];
  localeTimezoneOptions: { value: string; label: string }[];
  updateBusinessLocale: (country: string, timezone: string) => Promise<void>;

  blockRegularOnEventDays: boolean;
  updateBlockRegularOnEventDays: (enabled: boolean) => Promise<void>;

  branding: { business_name: string; business_tagline: string; logo_url: string };
  updateBranding: (data: {
    business_name: string;
    business_tagline?: string;
    logo_url?: string | null;
  }) => Promise<void>;
  uploadBrandingLogo: (logoDataUrl: string) => Promise<void>;

  offerings: OfferingSummary[];
  calendarOfferingSlots: OfferingSlotInstance[];
  fetchOfferings: () => Promise<void>;
  createOffering: (data: Record<string, unknown>) => Promise<number>;
  updateOffering: (id: number, data: Record<string, unknown>) => Promise<void>;
  goLiveOffering: (id: number) => Promise<AppointmentConflict[]>;
  duplicateOffering: (id: number) => Promise<number>;
  archiveOffering: (id: number) => Promise<void>;
  deleteOffering: (id: number) => Promise<void>;
  bookOfferingSlot: (slotId: number, data: {
    client_id: number;
    staff_id?: number | null;
    addon_ids?: number[];
    notes?: string;
  }) => Promise<void>;

  updateAppointment: (id: number, data: Partial<Appointment>) => Promise<void>;
  updateAppointmentAddons: (id: number, addonIds: number[]) => Promise<void>;
  deleteAppointment: (id: number) => Promise<void>;

  // Appointment detail
  selectedAppointment: Appointment | null;
  selectAppointment: (id: number | null) => Promise<void>;
  addAppointmentNote: (aptId: number, content: string) => Promise<void>;
  deleteAppointmentNote: (noteId: number) => Promise<void>;
  sendAppointmentPaymentLink: (id: number) => Promise<{
    page_url: string;
    link_token: string;
    balance_due: number;
    deposit_due: number;
    currency: string;
  }>;

  // Calendar
  calendarAppointments: Appointment[];
  calendarBlocked: BlockedSlot[];
  calendarEventDay: EventDayInfo;
  calendarDate: string;
  setCalendarDate: (date: string) => void;
  addBlockedSlot: (data: { staff_id: number; blocked_date: string; start_time: string; end_time: string; reason?: string }) => Promise<void>;
  deleteBlockedSlot: (id: number) => Promise<void>;

  // Clients
  clients: Client[];
  clientsPag: PaginatedState;
  setClientsPage: (page: number) => void;
  clientsSearch: string;
  setClientsSearch: (s: string) => void;
  addClient: (data: Partial<Client>) => Promise<Client>;
  updateClient: (id: number, data: Partial<Client>) => Promise<void>;
  deleteClient: (id: number) => Promise<void>;
  selectedClient: Client | null;
  selectedClientAppointments: Appointment[];
  selectClient: (id: number | null) => Promise<void>;

  // Staff
  staffMembers: Staff[];
  addStaff: (data: Partial<Staff>) => Promise<void>;
  updateStaff: (id: number, data: Partial<Staff>) => Promise<void>;
  deleteStaff: (id: number) => Promise<void>;

  // Services
  services: Service[];
  addService: (data: Partial<Service>) => Promise<void>;
  updateService: (id: number, data: Partial<Service>) => Promise<void>;
  deleteService: (id: number) => Promise<void>;

  // Products
  products: Product[];
  productsPag: PaginatedState;
  setProductsPage: (page: number) => void;
  productsSearch: string;
  setProductsSearch: (s: string) => void;
  addProduct: (data: Partial<Product>) => Promise<void>;
  updateProduct: (id: number, data: Partial<Product>) => Promise<void>;
  deleteProduct: (id: number) => Promise<void>;

  // Lookups
  clientLookup: ClientLookup[];
  staffLookup: StaffLookup[];

  loading: boolean;
  error: string | null;
  setError: (msg: string | null) => void;

  openMobileMenu?: () => void;
}

export const AppContext = createContext<AppContextValue>(null!);

export function useApp() {
  return useContext(AppContext);
}
