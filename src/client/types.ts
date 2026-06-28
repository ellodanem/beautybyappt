export type View = "dashboard" | "calendar" | "appointments" | "clients" | "staff" | "offers" | "products" | "settings";

export type AppointmentStatus = "booked" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";

export interface Appointment {
  id: number;
  identifier: string;
  client_id: number;
  staff_id: number | null;
  status: AppointmentStatus;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  total_price: number;
  currency?: string;
  deposit_amount?: number;
  amount_paid?: number;
  payment_status?: string;
  travel_fee?: number;
  service_address?: string;
  notes: string;
  is_recurring: number;
  recurrence_interval: string;
  client_name?: string;
  client_phone?: string;
  staff_name?: string | null;
  staff_color?: string | null;
  offering_name?: string | null;
  service_name?: string | null;
  offering_color?: string | null;
  service_color?: string | null;
  latest_note?: string | null;
  offering_id?: number | null;
  offering_base_price?: number | null;
  offering_addons?: OfferingAddon[];
  appointment_offering_addons?: AppointmentOfferingAddon[];
  appointment_services?: AppointmentService[];
  appointment_notes?: AppointmentNote[];
  pending_payment?: { amount: number; currency: string; created_at: string; page_url?: string | null; checkout_url?: string | null } | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentService {
  id: number;
  appointment_id: number;
  service_id: number;
  service_name?: string;
  price: number;
  duration: number;
}

export interface AppointmentOfferingAddon {
  id: number;
  appointment_id: number;
  offering_addon_id: number;
  price: number;
  name?: string;
  extra_duration?: number;
}

export interface AppointmentNote {
  id: number;
  appointment_id: number;
  content: string;
  created_at: string;
}

export interface Client {
  id: number;
  name: string;
  email: string;
  phone: string;
  address?: string;
  notes: string;
  appointment_count?: number;
  active_booking_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: number;
  name: string;
  email: string;
  phone: string;
  title: string;
  color: string;
  active: number;
  is_admin: number;
  appointment_count?: number;
  created_at: string;
}

export interface Service {
  id: number;
  name: string;
  slug: string;
  description: string;
  duration: number;
  price: number;
  color: string;
  category: string;
  active: number;
  created_at: string;
}

export interface BlockedSlot {
  id: number;
  staff_id: number;
  staff_name?: string;
  blocked_date: string;
  start_time: string;
  end_time: string;
  reason: string;
  created_at: string;
}

export interface Product {
  id: number;
  name: string;
  brand: string;
  category: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  low_stock_alert: number;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  appointments: number;
  clients: number;
  staff: number;
  services: number;
  products: number;
  today_appointments: number;
  upcoming_appointments: number;
  completed_appointments: number;
  revenue: number;
  low_stock_products: number;
}

export interface PaginatedState {
  page: number;
  limit: number;
  total: number;
}

export interface ClientLookup {
  id: number;
  name: string;
}

export interface StaffLookup {
  id: number;
  name: string;
  color: string;
}

export type OfferingStatus = "draft" | "live" | "completed" | "archived";

export interface OfferingSummary {
  id: number;
  name: string;
  slug: string;
  status: OfferingStatus;
  base_price: number;
  currency: string;
  color: string;
  category: string;
  capacity_per_slot: number;
  date_summary: string;
  created_at: string;
}

export interface OfferingDateWindow {
  id?: number;
  start_date: string;
  end_date: string;
}

export interface OfferingTimeSlot {
  id?: number;
  start_time: string;
  end_time: string;
}

export interface OfferingAddon {
  id?: number;
  name: string;
  price: number;
  extra_duration: number;
  active?: number;
}

export interface OfferingDetail {
  id: number;
  name: string;
  slug: string;
  description: string;
  detailed_description: string;
  base_price: number;
  currency: string;
  duration: number;
  color: string;
  category: string;
  status: OfferingStatus;
  capacity_per_slot: number;
  block_regular_bookings: boolean | null;
  staff_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface EventDayInfo {
  is_event_day: boolean;
  block_regular_bookings: boolean;
  event_names: string[];
}

export interface AppointmentConflict {
  id: number;
  identifier: string;
  scheduled_date: string;
  start_time: string;
  client_name: string;
}

export interface OfferingSlotInstance {
  id: number;
  offering_id: number;
  offering_name: string;
  offering_color: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked_count: number;
  base_price: number;
  currency: string;
  addons: OfferingAddon[];
}
