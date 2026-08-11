/**
 * Parsing and validation for the tracker admin's shipment form.
 *
 * Shared by /tracking/admin/new and /tracking/admin/[id] so the add and edit
 * forms can never drift apart — in the PHP version add.php and edit.php each
 * carried their own copy of this logic.
 */
import {
  SHIPPING_METHODS,
  STEP_COUNT,
  DEFAULT_STEPS,
  type ShipmentInput,
  type ShipmentStep,
} from './shipments';

export interface ParsedForm {
  data: ShipmentInput;
  steps: ShipmentStep[];
  error: string | null;
}

const str = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** Accepts only what <input type="date"> produces; anything else becomes null. */
const asDate = (value: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export function parseShipmentForm(form: FormData): ParsedForm {
  const bookingDate = asDate(str(form, 'booking_date'));
  const estimatedDelivery = asDate(str(form, 'estimated_delivery'));

  const method = str(form, 'shipping_method');
  const packages = Number.parseInt(str(form, 'total_packages'), 10);
  const currentStep = Number.parseInt(str(form, 'current_step'), 10);

  const data: ShipmentInput = {
    tracking_number: str(form, 'tracking_number'),
    invoice_number: str(form, 'invoice_number'),
    customer_name: str(form, 'customer_name'),
    origin: str(form, 'origin'),
    destination: str(form, 'destination'),
    total_packages: Number.isFinite(packages) && packages > 0 ? packages : 1,
    total_weight: str(form, 'total_weight'),
    // Guard against a tampered <select>: fall back to the first known method.
    shipping_method: (SHIPPING_METHODS as readonly string[]).includes(method)
      ? method
      : SHIPPING_METHODS[0],
    booking_date: bookingDate ?? '',
    estimated_delivery: estimatedDelivery ?? '',
    whatsapp_number: str(form, 'whatsapp_number') || null,
    current_step:
      Number.isFinite(currentStep) && currentStep >= 1 && currentStep <= STEP_COUNT
        ? currentStep
        : 1,
  };

  const steps: ShipmentStep[] = Array.from({ length: STEP_COUNT }, (_, i) => {
    const n = i + 1;
    return {
      step_number: n,
      // A blank title would leave the customer's timeline unlabelled.
      step_title: str(form, `step_title_${n}`) || DEFAULT_STEPS[i].step_title,
      step_description: str(form, `step_description_${n}`),
      step_date: asDate(str(form, `step_date_${n}`)),
      step_time: str(form, `step_time_${n}`) || null,
    };
  });

  // Same required fields the PHP enforced.
  let error: string | null = null;
  if (
    !data.tracking_number ||
    !data.invoice_number ||
    !data.customer_name ||
    !data.booking_date ||
    !data.estimated_delivery
  ) {
    error = 'Please fill in all required fields (marked *).';
  }

  return { data, steps, error };
}
