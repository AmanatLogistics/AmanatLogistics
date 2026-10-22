/**
 * The five lines of business ("sections"), as the office actually runs them.
 * Each has its own dashboard, and a new shipment of that kind starts with the
 * cost lines it always has, so nobody has to remember them.
 */

export type ServiceKey = 'ups' | 'china' | 'tashkent' | 'kabul_air' | 'other';

export interface CostTemplate {
  category: CostCategory;
  description: string;
  /** Quantity comes from the shipment: chargeable kg, CBM, or 1 (a fixed sum). */
  per: 'kg' | 'cbm' | 'fixed';
}

export interface ServiceDef {
  key: ServiceKey;
  label: string;
  short: string;
  /** One line on how the route works — shown on the section dashboard. */
  route: string;
  /** What the client is usually billed by. */
  unit: 'kg' | 'cbm' | 'fixed';
  chargeTemplate: { description: string; per: 'kg' | 'cbm' | 'fixed' }[];
  costTemplate: CostTemplate[];
}

export const COST_CATEGORIES = {
  truck: 'Truck / road transport',
  documents: 'Documents & clearance',
  loading: 'Loading & unloading',
  airline: 'Airline / air freight',
  airport_partner: 'Airport partner (all-in per kg)',
  kabul_rent: 'Kabul rent',
  kabul_agent: 'Kabul agent charges',
  china_agent: 'China agent (per CBM)',
  customs: 'Customs & duties',
  agent_fee: 'Other agent fee',
  other: 'Other cost',
} as const;
export type CostCategory = keyof typeof COST_CATEGORIES;

export const SERVICES: Record<ServiceKey, ServiceDef> = {
  ups: {
    key: 'ups',
    label: 'Courier — Kabul → Dubai → UPS',
    short: 'UPS Courier',
    route: 'Sent to Kabul; our Kabul agent forwards to Dubai and hands over to UPS. We pay the Kabul agent his rent and all other charges.',
    unit: 'kg',
    chargeTemplate: [{ description: 'Courier via UPS', per: 'kg' }],
    costTemplate: [
      { category: 'kabul_rent', description: 'Kabul rent', per: 'fixed' },
      { category: 'kabul_agent', description: 'Kabul agent — Dubai & UPS charges', per: 'fixed' },
    ],
  },
  china: {
    key: 'china',
    label: 'China consolidation — by CBM',
    short: 'China CBM',
    route: 'Clients hand cartons to our person in China, who loads and brings them to Kandahar. The client pays on arrival; we pay the China agent and keep the margin.',
    unit: 'cbm',
    chargeTemplate: [{ description: 'China → Kandahar consolidation', per: 'cbm' }],
    costTemplate: [{ category: 'china_agent', description: 'China agent — loading & transport', per: 'cbm' }],
  },
  tashkent: {
    key: 'tashkent',
    label: 'Air cargo via Tashkent',
    short: 'Tashkent Air',
    route: 'Kandahar truck → Hairatan (documents agent) → transload to Tashkent truck (Tashkent agent) → Tashkent airport partner, priced per kg all-in → airway bill issued.',
    unit: 'kg',
    chargeTemplate: [{ description: 'Air freight via Tashkent', per: 'kg' }],
    costTemplate: [
      { category: 'truck', description: 'Truck Kandahar → Hairatan', per: 'fixed' },
      { category: 'documents', description: 'Documents — clearance agent', per: 'fixed' },
      { category: 'loading', description: 'Loading / unloading — Tashkent agent', per: 'fixed' },
      { category: 'truck', description: 'Truck Hairatan → Tashkent airport', per: 'fixed' },
      { category: 'airport_partner', description: 'Tashkent airport partner (per kg, all-in)', per: 'kg' },
    ],
  },
  kabul_air: {
    key: 'kabul_air',
    label: 'Air cargo via Kabul airport',
    short: 'Kabul Air',
    route: 'Kandahar → Kabul airport; paid to the airline\'s bank account (Ariana Afghan, Kam Air).',
    unit: 'kg',
    chargeTemplate: [{ description: 'Air freight via Kabul', per: 'kg' }],
    costTemplate: [
      { category: 'truck', description: 'Truck Kandahar → Kabul', per: 'fixed' },
      { category: 'documents', description: 'Documents & clearance', per: 'fixed' },
      { category: 'airline', description: 'Airline freight (per kg)', per: 'kg' },
    ],
  },
  other: {
    key: 'other',
    label: 'Other shipments',
    short: 'Other',
    route: 'Dry fruit and other cargo on any other route.',
    unit: 'kg',
    chargeTemplate: [{ description: 'Freight', per: 'kg' }],
    costTemplate: [{ category: 'truck', description: 'Transport', per: 'fixed' }],
  },
};

export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];

export function isService(s: string | null | undefined): s is ServiceKey {
  // hasOwnProperty, not `in`: 'toString' or '__proto__' must not count as a section.
  return !!s && Object.prototype.hasOwnProperty.call(SERVICES, s);
}

export const SHIPMENT_STATUS = {
  booked: 'Booked',
  in_transit: 'In transit',
  arrived: 'Arrived',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
} as const;
export type ShipmentStatus = keyof typeof SHIPMENT_STATUS;

export const PARTY_KINDS = {
  client: 'Client',
  agent: 'Agent',
  carrier: 'Truck / carrier',
  airline: 'Airline',
  sarafi: 'Sarafi / hawala',
  supplier: 'Supplier',
  staff: 'Staff',
  other: 'Other',
} as const;
export type PartyKind = keyof typeof PARTY_KINDS;

export const ACCOUNT_TYPES = {
  cash: 'Cash box',
  bank: 'Bank account',
  sarafi: 'Sarafi (holds money for us)',
  hawala: 'Hawala',
  other: 'Other',
} as const;

export const EXPENSE_CATEGORIES = {
  rent: 'Office rent',
  salaries: 'Salaries',
  internet: 'Internet & phone',
  utilities: 'Electricity & utilities',
  fuel: 'Fuel & transport',
  food: 'Food & hospitality',
  stationery: 'Stationery & printing',
  repairs: 'Repairs & maintenance',
  fees: 'Bank & hawala fees',
  other: 'Other',
} as const;
