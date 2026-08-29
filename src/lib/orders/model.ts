/**
 * Sheet order -> the shapes the existing tracker components already render.
 *
 * Mapping here rather than building new components means /orders and
 * /orders/admin get the tracker's details panel, timeline, badges and status
 * buckets unchanged — the two sections cannot drift apart visually, and the
 * status rules live in exactly one place (lib/tracker/shipments.ts).
 */
import {
  DEFAULT_STEPS,
  STEP_COUNT,
  type Shipment,
  type ShipmentStep,
} from '../tracker/shipments';
import type { SheetOrder } from './api';

export { STEP_COUNT };

/** The order as the tracker's details panel and timeline expect it. */
export function toShipment(order: SheetOrder): Shipment {
  return {
    id: order.row,
    tracking_number: order.tracking_number,
    invoice_number: order.invoice_number,
    customer_name: order.customer_name,
    origin: order.origin,
    destination: order.destination,
    total_packages: Number(order.quantity) || 1,
    total_weight: order.weight,
    shipping_method: order.shipping_method,
    booking_date: order.order_date,
    estimated_delivery: order.estimated_delivery,
    actual_delivery: order.actual_delivery || null,
    whatsapp_number: order.whatsapp_number || null,
    current_step: order.stage,
  };
}

/**
 * The eight-stage timeline. Stage names come from the tracker's own defaults,
 * so a customer sees the same wording in both sections. Per-stage dates are
 * used when the sheet carries "Stage N Date" columns; otherwise the first and
 * last stages borrow the order and delivery dates, and the rest read as
 * "Pending" rather than inventing a date.
 */
export function toSteps(order: SheetOrder): ShipmentStep[] {
  return DEFAULT_STEPS.map((step, i) => {
    const n = i + 1;
    let date = order.stage_dates[i] || '';
    if (!date && n === 1) date = order.order_date;
    if (!date && n === STEP_COUNT) date = order.actual_delivery;
    return {
      step_number: n,
      step_title: step.step_title,
      step_description: step.step_description,
      step_date: date || null,
    };
  });
}

/** Stage name for a row, matching what the customer sees on the timeline. */
export function stageTitle(order: SheetOrder): string {
  return DEFAULT_STEPS[order.stage - 1]?.step_title ?? `Stage ${order.stage}`;
}

/** The text the admin search box matches a row against. */
export function searchText(order: SheetOrder): string {
  return [
    order.tracking_number,
    order.invoice_number,
    order.customer_name,
    order.product,
    order.destination,
  ]
    .join(' ')
    .toLowerCase();
}
