/**
 * Orders section — English / Pashto.
 *
 * The companion to lib/tracker/i18n.ts, and written the same way: by hand, not
 * by machine. Pashto is a low-resource language and automatic translation of it
 * is noticeably weaker than for major languages, so a fixed set of labels is
 * both more accurate and free when it is simply written out.
 *
 * The language itself is chosen by lib/tracker/i18n.ts (one cookie, one toggle),
 * so switching to Pashto on /tracking carries over to this section and back.
 *
 * NOTE FOR REVIEW: the strings below were written for this section and have not
 * yet been read by a native speaker. The stage names in particular are worth a
 * second pair of eyes — they are what a customer reads.
 */
import type { ShipmentStep } from '../tracker/shipments';
import type { SheetOrder } from './api';
import { GROUP_LABEL, ORDER_STAGES, type Group } from './model';
import { type Lang } from '../tracker/i18n';

export type { Lang };

/* ------------------------------------------------------------------ */
/* Page strings                                                        */
/* ------------------------------------------------------------------ */

const STRINGS = {
  // Page header
  eyebrow: { en: 'Order Lookup', ps: 'د اجناسو پلټنه' },
  pageTitle: { en: 'Track Your Order', ps: 'خپل اجناس تعقیب کړئ' },
  pageSubtitle: {
    en: 'Enter your ACCI invoice number or tracking number to follow your shipment through all fourteen stages, from our Kandahar warehouse to delivery in Delhi.',
    ps: 'خپل د ACCI بیل نمبر یا د تعقیب نمبر ولیکئ، ترڅو خپل اجناس په ټولو څوارلسو پړاوونو کې، زموږ د کندهار له ګودام څخه تر دهلي کې سپارلو پورې، تعقیب کړئ.',
  },
  docTitle: { en: 'Order Lookup', ps: 'د اجناسو پلټنه' },

  // Search
  cardTitle: { en: 'Find Your Order', ps: 'خپل اجناس ومومئ' },
  searchLabel: { en: 'Invoice or tracking number', ps: 'د بیل نمبر یا د تعقیب نمبر' },
  searchPlaceholder: {
    en: 'e.g. RN-062 or AM-0031-INV-062',
    ps: 'لکه RN-062 یا AM-0031-INV-062',
  },
  trackOrder: { en: 'Track Order', ps: 'پلټل' },

  // States
  emptyState: {
    en: 'Your ACCI invoice number is on the paperwork we sent you. Enter it above to see where your shipment has reached.',
    ps: 'ستاسو د ACCI بیل نمبر په هغو اسنادو کې دی چې موږ تاسو ته لېږلي دي. د دې لیدو لپاره چې ستاسو اجناس چیرته رسېدلی، پورته یې ولیکئ.',
  },
  notFound: { en: 'No order found for', ps: 'هیڅ ونه موندل سوه ' },
  notFoundHint: {
    en: 'Please check the number and try again.',
    ps: 'مهرباني وکړئ نمبر وګورئ او بیا هڅه وکړئ.',
  },
  unavailable: {
    en: 'Order lookup is temporarily unavailable. Please try again shortly.',
    ps: 'د اجناسو پلټنه اوس مهال شتون نه لري. مهرباني وکړئ یوه شېبه وروسته بیا هڅه وکړئ.',
  },
  lookupFailed: {
    en: 'We could not reach our order records just now. Please try again shortly.',
    ps: 'موږ اوس زموږ د اجناسو ریکارډ ته لاسرسی ونه موند. مهرباني وکړئ یوه شېبه وروسته بیا هڅه وکړئ.',
  },

  // Current-status panel
  currentStatus: { en: 'Current status', ps: 'اوسنی حالت' },
  route: {
    en: 'Kandahar → Hairatan → Termez → Tashkent → Delhi',
    ps: 'کندهار ← حیرتان ← ترمز ← تاشکند ← دهلي',
  },
  shipmentDetails: { en: 'Shipment Details', ps: 'د اجناسو جزئیات' },

  // Detail rows — the SHIPMENTS sheet's own fields, in its own wording.
  trackingNumber: { en: 'Tracking Number', ps: 'د تعقیب نمبر' },
  invoiceNumber: { en: 'ACCI Invoice No', ps: 'د ACCI بیل نمبر' },
  invoiceDate: { en: 'Invoice Date', ps: 'د بیل نیټه' },
  commodity: { en: 'Commodity', ps: 'جنس' },
  cartons: { en: 'Cartons / Pkgs', ps: 'کارتنونه / بستې' },
  grossWeight: { en: 'Gross Weight', ps: 'ټول وزن' },
  kdrTruck: { en: 'Kandahar Truck', ps: 'د کندهار موټر' },
  tasTruck: { en: 'Tashkent Truck', ps: 'د تاشکند موټر' },
  awbNo: { en: 'AWB No', ps: 'د هوايي بار نمبر' },
  flightNo: { en: 'Flight No', ps: 'د الوتنې نمبر' },
  flightDate: { en: 'Flight Date', ps: 'د الوتنې نیټه' },
  estimatedDelivery: { en: 'Estimated Delivery', ps: 'د رسیدو اټکل سوې نیټه' },
  deliveredOn: { en: 'Delivered', ps: 'د سپارلو نیټه' },

  // Footer note
  cantFind: { en: "Can't find your order?", ps: 'خپل اجناس نه مومئ؟' },
  contactTeam: { en: 'Contact our team', ps: 'زموږ ټیم سره اړیکه ونیسئ' },
  andWeLook: { en: "and we'll look it up for you.", ps: 'او موږ به یې درته وګورو.' },
} satisfies Record<string, Record<Lang, string>>;

export type OrderStringKey = keyof typeof STRINGS;

export function ot(lang: Lang, key: OrderStringKey): string {
  return STRINGS[key][lang] ?? STRINGS[key].en;
}

/** "stage 6 of 14", written out so the numbers sit correctly in either script. */
export function stageOfLabel(lang: Lang, stage: number, total: number): string {
  return lang === 'ps' ? `پړاو ${stage} له ${total} څخه` : `stage ${stage} of ${total}`;
}

/* ------------------------------------------------------------------ */
/* The fourteen stages                                                 */
/* ------------------------------------------------------------------ */

/**
 * Pashto for the sheet's own fourteen stage names and their descriptions,
 * indexed by stage number − 1 so they stay locked to ORDER_STAGES.
 */
const STAGES_PS: { title: string; description: string }[] = [
  { title: 'کندهار — اسناد جوړ شول',            description: 'د صادراتو اسناد په کندهار کې جوړ شول.' },
  { title: 'کندهار — ګمرکي پروسه بشپړه شوه',    description: 'په کندهار کې د ګمرک پروسه بشپړه شوه.' },
  { title: 'له کندهار څخه روان شو',             description: 'موټر زموږ د کندهار له ګودام څخه روان شو.' },
  { title: 'کابل ته ورسېد',                     description: 'په ځمکنۍ لاره کې کابل ته ورسېد.' },
  { title: 'د سالنګ له کوتل تېر شو',            description: 'د سالنګ له کوتل څخه تېر شو.' },
  { title: 'حیرتان ته ورسېد',                   description: 'د ازبکستان پر پوله، حیرتان ته ورسېد.' },
  { title: 'حیرتان — اسناد جوړ شول',            description: 'د صادراتو اسناد په حیرتان کې جوړ شول.' },
  { title: 'د تاشکند موټر ته بار شو',           description: 'مال د ازبکستان موټر ته واړول شو.' },
  { title: 'حیرتان — ګمرکي پروسه بشپړه شوه',    description: 'په حیرتان کې د ګمرک پروسه بشپړه شوه.' },
  { title: 'د ترمز پر پوله',                    description: 'د ترمز په پوله کې دی.' },
  { title: 'تاشکند ته په لاره کې',              description: 'تاشکند ته په لاره کې دی.' },
  { title: 'د تاشکند هوايي ډګر ته ورسېد',       description: 'د تاشکند هوايي ډګر ته ورسېد.' },
  { title: 'ثبت او پروسه بشپړه — د الوتنې په تمه', description: 'ثبت او ګمرکي پروسه بشپړه ده، د الوتکې په تمه دی.' },
  { title: 'دهلي کې وسپارل شو',                 description: 'په دهلي کې اخیستونکي ته وسپارل شو.' },
];

/** "Booked" — a shipment exists from the moment its ACCI invoice is created. */
const BOOKED: Record<Lang, string> = {
  en: 'Booked — ACCI invoice created',
  ps: 'ثبت شوی — د ACCI بیل جوړ شوی',
};

/** The stage a shipment is sitting on, in the reader's language. */
export function stageTitleIn(order: SheetOrder, lang: Lang): string {
  if (order.stage < 1) return BOOKED[lang];
  const i = order.stage - 1;
  if (lang === 'ps') return STAGES_PS[i]?.title ?? ORDER_STAGES[i]?.title ?? `پړاو ${order.stage}`;
  return ORDER_STAGES[i]?.title ?? `Stage ${order.stage}`;
}

/** The fourteen timeline steps, translated. */
export function stepsIn(order: SheetOrder, lang: Lang): ShipmentStep[] {
  return ORDER_STAGES.map((stage, i) => ({
    step_number: stage.n,
    step_title: (lang === 'ps' ? STAGES_PS[i]?.title : '') || stage.title,
    step_description: (lang === 'ps' ? STAGES_PS[i]?.description : '') || stage.description,
    step_date: order.stage_dates[i] || null,
  }));
}

/* ------------------------------------------------------------------ */
/* The seven legs                                                      */
/* ------------------------------------------------------------------ */

const GROUP_PS: Record<Group, string> = {
  booked: 'ثبت شوی',
  kandahar: 'کندهار',
  road: 'حیرتان ته په لاره',
  hairatan: 'حیرتان',
  uzbek: 'ازبکستان',
  airport: 'د تاشکند هوايي ډګر',
  delivered: 'وسپارل شو',
};

export function groupLabelIn(group: Group, lang: Lang): string {
  return (lang === 'ps' ? GROUP_PS[group] : '') || GROUP_LABEL[group];
}
