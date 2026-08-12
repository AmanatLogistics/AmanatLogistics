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
  eyebrow: { en: 'Shipment Tracking', ps: 'د محمولې تعقیب' },
  pageTitle: { en: 'Track Your Shipment', ps: 'خپله محموله تعقیب کړئ' },
  pageSubtitle: {
    en: 'Enter your tracking number or invoice number to follow your consignment from our Kandahar warehouse right through to delivery.',
    ps: 'د خپلې محمولې د تعقیب لپاره، زموږ د کندهار له ګودام څخه تر سپارلو پورې، خپل د تعقیب نمبر یا د بیل نمبر ولیکئ.',
  },

  // Search
  cardTitle: { en: 'Track Your Shipment', ps: 'خپله محموله تعقیب کړئ' },
  searchLabel: { en: 'Tracking number or invoice number', ps: 'د تعقیب نمبر یا د بیل نمبر' },
  searchPlaceholder: {
    en: 'Enter Tracking Number or Invoice Number',
    ps: 'د تعقیب نمبر یا د بیل نمبر ولیکئ',
  },
  trackNow: { en: 'Track Now', ps: 'اوس یې وپلټئ' },

  // States
  emptyState: {
    en: 'Enter your tracking or invoice number above to see your shipment status.',
    ps: 'د خپلې محمولې د حالت لیدو لپاره پورته خپل د تعقیب یا بیل نمبر ولیکئ.',
  },
  notFound: {
    en: 'No shipment found for',
    ps: 'هېڅ محموله ونه موندل شوه د',
  },
  notFoundHint: {
    en: 'Please check the tracking or invoice number and try again.',
    ps: 'مهرباني وکړئ خپل د تعقیب یا د بیل نمبر وګورئ او بیا هڅه وکړئ.',
  },
  unavailable: {
    en: 'Tracking is not available right now. Please contact us and we will check your shipment for you.',
    ps: 'تعقیب اوس مهال شتون نه لري. مهرباني وکړئ زموږ سره اړیکه ونیسئ، موږ به ستاسو محموله وګورو.',
  },
  lookupFailed: {
    en: 'We could not reach the tracking system just now. Please try again in a moment.',
    ps: 'موږ اوس د تعقیب سیسټم ته لاسرسی ونه موند. مهرباني وکړئ یوه شېبه وروسته بیا هڅه وکړئ.',
  },

  // Details panel
  shipmentDetails: { en: 'Shipment Details', ps: 'د محمولې جزئیات' },
  trackingNumber: { en: 'Tracking Number', ps: 'د تعقیب نمبر' },
  invoiceNumber: { en: 'Invoice Number', ps: 'د بیل نمبر' },
  customerName: { en: 'Customer Name', ps: 'د پیرودونکي نوم' },
  origin: { en: 'Origin', ps: 'د پیل ځای' },
  destination: { en: 'Destination', ps: 'د رسېدو ځای' },
  totalPackages: { en: 'Total Packages', ps: 'ټولې بستې' },
  totalWeight: { en: 'Total Weight', ps: 'ټول وزن' },
  shippingMethod: { en: 'Shipping Method', ps: 'د لېږد طریقه' },
  bookingDate: { en: 'Booking Date', ps: 'د ثبت نېټه' },
  estimatedDelivery: { en: 'Estimated Delivery', ps: 'د رسېدو اټکل شوې نېټه' },
  whatsapp: { en: 'Chat on WhatsApp', ps: 'په واټساپ کې خبرې وکړئ' },

  // Timeline
  shipmentProgress: { en: 'Shipment Progress', ps: 'د محمولې پرمختګ' },
  currentStatus: { en: 'Current Status', ps: 'اوسنی حالت' },
  pending: { en: 'Pending', ps: 'په تمه' },

  // Footer note
  cantFind: { en: "Can't find your shipment?", ps: 'خپله محموله نه مومئ؟' },
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
  'shipment received': 'محموله ترلاسه شوه',
  'custon clearnce': 'ګمرکي پروسه',
  'custom clearance': 'ګمرکي پروسه',
  'departed origin': 'له مبدأ څخه روانه شوه',
  'in salang': 'په سالنګ کې',
  'hairatan customs clearance': 'د حیرتان ګمرکي پروسه',
  'in transit': 'په لاره کې',
  'tashkent airport': 'د تاشکند هوايي ډګر',
  delivered: 'وسپارل شوه',

  // Stage descriptions
  'we have received your shipment at our origin office.':
    'موږ ستاسو محموله زموږ په ابتدايي دفتر کې ترلاسه کړه.',
  'your shipment waiting for shipment clearence.': 'ستاسو محموله د ګمرکي پروسې په تمه ده.',
  'your shipment waiting for shipment clearance.': 'ستاسو محموله د ګمرکي پروسې په تمه ده.',
  'your shipment has departed from origin.': 'ستاسو محموله له مبدأ څخه روانه شوه.',
  'your shipment is passing salang pass.': 'ستاسو محموله د سالنګ له کوتلې تېرېږي.',
  'your shipment is pending hairatan customs clearance.':
    'ستاسو محموله د حیرتان د ګمرک د پروسې په تمه ده.',
  'your shipment is in transit to tashkent.': 'ستاسو محموله تاشکند ته په لاره کې ده.',
  'your shipment is in tashkent airport.': 'ستاسو محموله د تاشکند په هوايي ډګر کې ده.',
  'your shipment has been delivered.': 'ستاسو محموله وسپارل شوه.',

  // Shipping methods (the four the admin can choose)
  'sea freight': 'بحري لېږد',
  'air freight': 'هوايي لېږد',
  'land freight': 'ځمکنی لېږد',
  express: 'چټک لېږد',
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
