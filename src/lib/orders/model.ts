/**
 * The SHIPMENTS sheet's own model: fourteen stages from Kandahar to Delhi.
 *
 * Names, order and grouping are taken from the workbook itself — its stage
 * columns and the colour key in its README — not invented here. Stage 0 means
 * booked: a shipment exists from the moment its ACCI invoice is created.
 *
 * A shipment's stage is the HIGHEST numbered date present, never a count of
 * filled dates: route KDR leaves stage 7 empty and route HRTN leaves stages 1
 * and 2 empty, so counting would under-report both.
 */
import type { ShipmentStep } from '../tracker/shipments';
import type { SheetOrder } from './api';

export interface Stage {
  n: number;
  title: string;
  description: string;
}

export const ORDER_STAGES: Stage[] = [
  { n: 1,  title: 'Docs Created — Kandahar',            description: 'Export paperwork raised in Kandahar.' },
  { n: 2,  title: 'Customs Cleared — Kandahar',         description: 'Cleared by customs in Kandahar.' },
  { n: 3,  title: 'Departed Kandahar',                  description: 'The truck has left our Kandahar warehouse.' },
  { n: 4,  title: 'Reached Kabul',                      description: 'Arrived in Kabul on the inland leg.' },
  { n: 5,  title: 'Passed Salang',                      description: 'Through the Salang pass.' },
  { n: 6,  title: 'Reached Hairatan',                   description: 'Arrived at Hairatan on the Uzbek border.' },
  { n: 7,  title: 'Docs Created — Hairatan',            description: 'Export paperwork raised at Hairatan.' },
  { n: 8,  title: 'Loaded to TAS Truck',                description: 'Transloaded onto the Uzbek truck.' },
  { n: 9,  title: 'Customs Cleared — Hairatan',         description: 'Cleared by customs at Hairatan.' },
  { n: 10, title: 'At Termez Border',                   description: 'At the Termez border crossing.' },
  { n: 11, title: 'On the Way to Tashkent',             description: 'On the road to Tashkent.' },
  { n: 12, title: 'Reached Tashkent Airport',           description: 'Arrived at Tashkent airport.' },
  { n: 13, title: 'Booked & Cleared — Awaiting Flight', description: 'Booked and cleared, waiting for its flight.' },
  { n: 14, title: 'Delivered to Delhi',                 description: 'Delivered to the consignee in Delhi.' },
];

export const ORDER_STAGE_COUNT = ORDER_STAGES.length;

/**
 * The seven groups the workbook itself colour-codes the status column by:
 * booked, Kandahar paperwork, the road to Hairatan, Hairatan handling, the
 * Uzbek road leg, Tashkent airport, delivered.
 */
export const GROUPS = ['booked', 'kandahar', 'road', 'hairatan', 'uzbek', 'airport', 'delivered'] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABEL: Record<Group, string> = {
  booked: 'Booked',
  kandahar: 'Kandahar',
  road: 'To Hairatan',
  hairatan: 'Hairatan',
  uzbek: 'Uzbekistan',
  airport: 'Tashkent Airport',
  delivered: 'Delivered',
};

/** What each group means, for the dashboard tiles. */
export const GROUP_NOTE: Record<Group, string> = {
  booked: 'Invoice raised, not moving yet',
  kandahar: 'Docs and customs in Kandahar',
  road: 'On the road to Hairatan',
  hairatan: 'Transload and customs at Hairatan',
  uzbek: 'Termez and the road to Tashkent',
  airport: 'At the airport, awaiting flight',
  delivered: 'Delivered to Delhi',
};

/** Maps onto the tones already in the admin stylesheet. */
export const GROUP_TONE: Record<Group, string> = {
  booked: 'idle',
  kandahar: 'late',
  road: 'transit',
  hairatan: 'teal',
  uzbek: 'purple',
  airport: 'orange',
  delivered: 'done',
};

export function groupOf(stage: number): Group {
  if (stage >= 14) return 'delivered';
  if (stage >= 12) return 'airport';
  if (stage >= 10) return 'uzbek';
  if (stage >= 7) return 'hairatan';
  if (stage >= 3) return 'road';
  if (stage >= 1) return 'kandahar';
  return 'booked';
}

export function asGroup(value: string): Group | '' {
  return (GROUPS as readonly string[]).includes(value) ? (value as Group) : '';
}

export type GroupCounts = Record<Group | 'total', number>;

export function countByGroup(orders: SheetOrder[]): GroupCounts {
  const counts = { total: orders.length } as GroupCounts;
  for (const group of GROUPS) counts[group] = 0;
  for (const order of orders) counts[groupOf(order.stage)]++;
  return counts;
}

/** The stage a shipment is sitting on, in words. */
export function stageTitle(order: SheetOrder): string {
  if (order.stage < 1) return 'Booked — ACCI invoice created';
  return ORDER_STAGES[order.stage - 1]?.title ?? `Stage ${order.stage}`;
}

/** The date it reached that stage, or the invoice date while still booked. */
export function stageDate(order: SheetOrder): string {
  if (order.stage < 1) return order.invoice_date;
  return order.stage_dates[order.stage - 1] ?? '';
}

/**
 * The fourteen steps for the tracker's timeline component. A stage with no
 * date reads as "Pending"; one that a route skips shows as passed rather than
 * pending, because the shipment is demonstrably beyond it.
 */
export function toSteps(order: SheetOrder): ShipmentStep[] {
  return ORDER_STAGES.map((stage, i) => ({
    step_number: stage.n,
    step_title: stage.title,
    step_description: stage.description,
    step_date: order.stage_dates[i] || null,
  }));
}

/** What the admin search box matches a row against. */
export function searchText(order: SheetOrder): string {
  return [
    order.invoice_number,
    order.tracking_number,
    order.commodity,
    order.kdr_plate,
    order.tas_plate,
    order.awb_no,
    order.flight_no,
  ]
    .join(' ')
    .toLowerCase();
}

/** "8150" -> "8,150 kg" for display; anything unexpected passes through. */
export function formatWeight(value: string): string {
  if (!value) return '';
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString('en-US')} kg` : value;
}

export function formatCount(value: string): string {
  if (!value) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : value;
}
