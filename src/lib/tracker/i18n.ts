/**
 * Tracking pages — English / Pashto.
 *
 * Scope is deliberately the tracker only: the rest of the site stays English.
 *
 * Every string here is hand-written rather than machine-translated. Pashto is a
 * low-resource language and automatic translation of it is noticeably weaker
 * than for major languages, so for a fixed set of labels a written translation
 * is both more accurate and free. Machine translation is used only as a
 * fallback for text an admin types that isn't one of the standard stages —
 * see ./translate.ts.
 */

export const LANGS = ['en', 'ps'] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'en';

/** Native name shown on the toggle button. */
export const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  ps: 'پښتو',
};

/** Pashto is written right-to-left. */
export const isRtl = (lang: Lang): boolean => lang === 'ps';

/** Locale for the <html lang> / dir attributes on the tracking markup. */
export const htmlLang: Record<Lang, string> = { en: 'en', ps: 'ps' };

/* ------------------------------------------------------------------ */
/* UI strings                                                          */
/* ------------------------------------------------------------------ */

const STRINGS = {
  // Page header
  eyebrow: { en: 'Shipment Tracking', ps: 'د اجناسو تعقیب' },
  pageTitle: { en: 'Track Your Shipment', ps: 'خپل اجناس تعقیب کړئ' },
  pageSubtitle: {
    en: 'Enter your tracking number or invoice number to follow your consignment from our Kandahar warehouse right through to delivery.',
    ps: 'د خپلو اجناسو د تعقیب لپاره، زموږ د کندهار له ګودام څخه تر سپارلو پورې، خپل د تعقیب نمبر یا د بیل نمبر ولیکئ.',
  },

  // Search
  cardTitle: { en: 'Track Your Shipment', ps: 'خپل اجناس تعقیب کړئ' },
  searchLabel: { en: 'Tracking number or invoice number', ps: 'د تعقیب نمبر یا د بیل نمبر' },
  searchPlaceholder: {
    en: 'Enter Tracking Number or Invoice Number',
    ps: 'د تعقیب نمبر یا د بیل نمبر ولیکئ',
  },
  trackNow: { en: 'Track Now', ps: 'پلټل' },

  // States
  emptyState: {
    en: 'Enter your tracking or invoice number above to see your shipment status.',
    ps: 'د خپل اجناسو د حالت لیدو لپاره پورته خپل د تعقیب یا بیل نمبر ولیکئ.',
  },
  notFound: {
    en: 'No shipment found for',
    ps: 'هیڅ ونه موندل سوه ',
  },
  notFoundHint: {
    en: 'Please check the tracking or invoice number and try again.',
    ps: 'مهرباني وکړئ خپل د تعقیب یا د بیل نمبر وګورئ او بیا هڅه وکړئ.',
  },
  unavailable: {
    en: 'Tracking is not available right now. Please contact us and we will check your shipment for you.',
    ps: 'تعقیب اوس مهال شتون نه لري. مهرباني وکړئ زموږ سره اړیکه ونیسئ.',
  },
  lookupFailed: {
    en: 'We could not reach the tracking system just now. Please try again in a moment.',
    ps: 'موږ اوس د تعقیب سیسټم ته لاسرسی ونه موند. مهرباني وکړئ یوه شېبه وروسته بیا هڅه وکړئ.',
  },

  // Details panel
  shipmentDetails: { en: 'Shipment Details', ps: 'د اجناسو جزئیات' },
  trackingNumber: { en: 'Tracking Number', ps: 'د تعقیب نمبر' },
  invoiceNumber: { en: 'Invoice Number', ps: 'د بیل نمبر' },
  customerName: { en: 'Customer Name', ps: 'د پیرودونکي نوم' },
  origin: { en: 'Origin', ps: 'د پیل ځای' },
  destination: { en: 'Destination', ps: 'د رسیدو ځای' },
  totalPackages: { en: 'Total Packages', ps: 'جمله کاټنان' },
  totalWeight: { en: 'Total Weight', ps: 'جمله وزن' },
  shippingMethod: { en: 'Shipping Method', ps: 'د لیږد طریقه' },
  bookingDate: { en: 'Booking Date', ps: 'د ثبت نیټه' },
  estimatedDelivery: { en: 'Estimated Delivery', ps: 'د رسیدو اټکل سوې نیټه' },
  actualDelivery: { en: 'Actual Delivery', ps: 'د رسیدو اصلي نیټه' },
  whatsapp: { en: 'Chat on WhatsApp', ps: 'په واتسف کی اړیکه ونیسی' },

  // Timeline
  shipmentProgress: { en: 'Shipment Progress', ps: 'د اجناسو د لیږدولو جریان' },
  currentStatus: { en: 'Current Status', ps: 'اوسنی حالت' },
  pending: { en: 'Pending', ps: 'په تمه' },

  // Footer note
  cantFind: { en: "Can't find your shipment?", ps: 'ستاسی اجناس ثبت نه لری؟' },
  contactTeam: { en: 'Contact our team', ps: 'زموږ ټیم سره اړیکه ونیسئ' },
  andWeLook: { en: "and we'll look into it.", ps: 'او موږ به یې وګورو.' },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

/** Look up a UI string. */
export function t(lang: Lang, key: StringKey): string {
  return STRINGS[key][lang] ?? STRINGS[key].en;
}

/* ------------------------------------------------------------------ */
/* Shipment content                                                    */
/* ------------------------------------------------------------------ */

/**
 * Pashto for the standard stage names and descriptions (the eight in
 * DEFAULT_STEPS) and the shipping methods. Keyed by the exact English text, so
 * a shipment using the standard stages is translated instantly and for free.
 *
 * Keys are matched case-insensitively with surrounding whitespace ignored, so a
 * stray capital or trailing space still resolves. Anything genuinely different —
 * a stage an admin renamed — falls through to ./translate.ts.
 */
const CONTENT_PS: Record<string, string> = {
  // Stage names
  'shipment received': 'اجناس ترلاسه شوه',
  'custon clearnce': 'ګمرکي پروسه',
  'kandahar custom clearance': 'کندهار کمرګ پروسه',
  'departed origin': 'له کندهار څخه اجناس واستول سول',
  'in salang': ' اجناس په سالنک کی دی',
  'hairatan customs clearance': 'د حیرتان ګمرکي پروسه',
  'in transit': 'اجناس د ازبکستان پر باډر دی',
  'tashkent airport': 'اجناس د تاشکند هوايي ډګر',
  'delivered': 'وسپارل سوه',

  // Stage descriptions
  'we have received your shipment at our origin office.':
    'موږ ستاسو اجناس زموږ د کندهار په دفتر کې ترلاسه کړه.',
  'your shipment waiting for shipment clearence.': 'ستاسو اجناس د ګمرکي پروسې په تمه دی.',
  'your shipment waiting for shipment clearance.': 'ستاسو اجناس د ګمرکي پروسې په تمه دی.',
  'your shipment has departed from origin.': 'ستاسو اجناس له کندهار  څخه روانه سوه.',
  'your shipment is passing salang pass.': 'ستاسو اجناس د سالنګ له کوتل څخه تیرېږي.',
  'your shipment is pending hairatan customs clearance.':
    'ستاسو اجناس د حیرتان د ګمرک د پروسې په تمه دی.',
  'your shipment is in transit to tashkent.': 'ستاسو اجناس تاشکند ته په لاره کې دۍ.',
  'your shipment is in tashkent airport.': 'ستاسو اجناس د تاشکند په هوايي ډګر کې دۍ.',
  'your shipment has been delivered.': 'ستاسو اجناس وسپارل سوه.',

  // Shipping methods (the four the admin can choose)
  'sea freight': 'سمندری لیږد',
  'air freight': 'هوايي لیږد',
  'land freight': 'ځمکنی لیږد',
  'express': 'چټک لیږد',
};

/**
 * Translate a piece of shipment content using the written dictionary.
 * Returns null when there is no entry — the caller then decides whether to ask
 * the machine-translation fallback.
 */
export function lookupContent(text: string, lang: Lang): string | null {
  if (lang === 'en') return text;
  const hit = CONTENT_PS[text.trim().toLowerCase()];
  return hit ?? null;
}

/* ------------------------------------------------------------------ */
/* Choosing the language                                               */
/* ------------------------------------------------------------------ */

const COOKIE = 'amanat_lang';

const isLang = (v: string): v is Lang => (LANGS as readonly string[]).includes(v);

/**
 * `?lang=` wins (it is what the toggle sets), then the remembered cookie,
 * otherwise English.
 */
export function resolveLang(url: URL, request: Request): Lang {
  const param = url.searchParams.get('lang');
  if (param && isLang(param)) return param;

  const cookies = request.headers.get('cookie') ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (match && isLang(match[1])) return match[1];

  return DEFAULT_LANG;
}

/** Remember the choice so the next visit opens in the same language. */
export function langCookie(lang: Lang): string {
  return `${COOKIE}=${lang}; Path=/; SameSite=Lax; Max-Age=${365 * 86400}`;
}

/** The other language — what the toggle button switches to. */
export const otherLang = (lang: Lang): Lang => (lang === 'en' ? 'ps' : 'en');
