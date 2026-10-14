/**
 * Built-in wording the site has since retired, and what each piece became:
 *   - from when it presented Amanat as a fruit exporter ("Premium Figs & Dry
 *     Fruits, From Kandahar to the World.");
 *   - from when it still offered global personal shopping;
 *   - the black copy of the logo, from before the site took the logo's maroon.
 *
 * Why this is needed: /admin saves a whole section at once. Any section saved
 * before the rewrite holds the old text in every field — including the fields
 * nobody touched — and saved text always wins over the defaults in consts.ts.
 * So the old fruit wording kept showing on the live site even though the code
 * no longer contained it.
 *
 * Only exact matches are swapped. A value equal to one of these strings is the
 * old built-in text, not something the office wrote, so replacing it loses
 * nothing; anything that was actually edited differs and is left alone.
 */
import { DEFAULT_CONTENT, type SiteContent } from '../consts';

/** field name → old built-in text → what to show instead */
type Swaps = Record<string, Record<string, string>>;

const D = DEFAULT_CONTENT;

/** Sections that are a single object of fields. */
const OBJECTS: Record<string, Swaps> = {
  brand: {
    logo: { '/images/brand-logo.png': D.brand.logo },
  },
  hero: {
    eyebrow: { 'Kandahar, Afghanistan': D.hero.eyebrow },
    title: { 'Premium Figs & Dry Fruits, From Kandahar to the World.': D.hero.title },
    subtitle: {
      "Trusted export and freight partner delivering Afghanistan's finest produce across the globe.": D.hero.subtitle,
    },
    image: { '/images/hero-home.jpg': D.hero.image },
  },
  seo: {
    description: {
      'Premium figs & dry fruits, from Kandahar to the world — exported with integrity, delivered with care. Export & freight plus global personal shopping.':
        D.seo.description,
      'Freight forwarding, customs clearance and cargo logistics from Kandahar, Afghanistan — road, air and sea freight to markets worldwide, plus global personal shopping.':
        D.seo.description,
    },
  },
  images: {
    aboutStory: { '/images/about-story.jpg': D.images.aboutStory },
  },
  services: {
    exportTitle: { 'Export & Freight': D.services.exportTitle },
    exportText: {
      'Premium figs, dry fruits, and fresh fruits from Afghanistan — shipped by sea, air, and land with certified documentation and careful handling at every step.':
        D.services.exportText,
    },
  },
  about: {
    p1: {
      "Amanat Logistics was founded in Kandahar, in the heart of one of the world's great fruit-growing regions. For generations, our land has produced figs, raisins, almonds, and pomegranates prized across the region for their sweetness and quality. We saw an opportunity to bring that heritage to international markets — properly graded, certified, and delivered with care.":
        D.about.p1,
    },
    p2: {
      '"Amanat" means a trust — something precious placed in your safekeeping. That word guides everything we do. We work directly with growers, control quality at our own facilities, and manage export logistics end to end, so our partners deal with one accountable company built on honesty and consistency.':
        D.about.p2,
    },
    p3: {
      "Today we serve importers, distributors, and officials across several continents — and we're proud to represent the very best of Afghan agriculture wherever our shipments arrive.":
        D.about.p3,
    },
  },
};

/** The coloured band at the top of each inner page, by page. */
const PAGE_HEADERS: Record<string, Swaps> = {
  services: {
    subtitle: {
      "From Kandahar's orchards to ports worldwide — and from global marketplaces back to your door. Two services, delivered with the same standard of trust.":
        D.pageHeaders.services.subtitle,
      'Freight forwarding, customs clearance and cargo handling from Kandahar to ports worldwide — and from global marketplaces back to your door. Two services, delivered with the same standard of trust.':
        D.pageHeaders.services.subtitle,
    },
  },
  about: {
    subtitle: {
      "A Kandahar-rooted company carrying Afghanistan's finest produce to the world — with a name that means trust.":
        D.pageHeaders.about.subtitle,
    },
  },
  routes: {
    subtitle: {
      'Established export corridors from Kandahar to markets across three continents — with new destinations added as our partnerships grow.':
        D.pageHeaders.routes.subtitle,
    },
  },
  gallery: {
    subtitle: {
      'Our products, our facilities, and our shipments — real photography builds real trust.': D.pageHeaders.gallery.subtitle,
    },
  },
  contact: {
    subtitle: {
      'Reach the right team directly, or send a detailed quote request below. Serious inquiries from importers, distributors, and officials are always welcome.':
        D.pageHeaders.contact.subtitle,
      'Reach the right team directly, or send a detailed quote request below. Exporters, importers, traders, and officials are always welcome.':
        D.pageHeaders.contact.subtitle,
    },
  },
};

/**
 * Sections that are lists. Matched field by field rather than item by item, so
 * a card whose title was edited still loses its old built-in description.
 */
const LISTS: Record<string, Swaps> = {
  stats: {
    value: { Kandahar: 'Road · Air · Sea' },
    label: { 'Orders Completed': 'Shipments Completed', 'Sourced At Origin': 'Freight Modes' },
  },
  why: {
    title: { 'Authentic Afghan origin': 'Customs & paperwork handled' },
    text: {
      "Sourced directly from Kandahar's orchards and growers — provenance you can document.":
        'Declarations, certificates and export documents prepared and checked, so cargo is not held at the border.',
      'A single accountable partner for officials, importers, and institutional buyers.':
        'A single accountable partner for exporters, importers, traders, and officials.',
    },
  },
  values: {
    title: { Authenticity: 'Accountability', Quality: 'Care' },
    line: {
      "Genuine Afghan origin, sourced directly from Kandahar's growers.":
        'One team answerable for your cargo, from pickup to delivery.',
      'Consistent grading and food-safe handling on every consignment.':
        'Careful handling, packing and storage on every consignment, perishables included.',
    },
  },
  freightModes: {
    text: {
      'Cost-efficient bulk shipping for large dry-fruit consignments, with full container and consolidated options.':
        'Cost-efficient bulk shipping for large consignments, with full-container and consolidated options through regional ports.',
      'Fast, temperature-aware shipping for fresh fruit and priority orders — days from Kandahar to your port.':
        'Fast, temperature-aware air cargo for perishables, samples and priority shipments — days from Kandahar to your airport.',
    },
  },
  destinations: {
    delivers: {
      'Figs · dry fruits · fresh produce': 'Dry fruit · fresh produce · general cargo',
      'Figs · dry fruits · nuts': 'Dry fruit · nuts · general cargo',
    },
  },
};

function swapFields<T>(item: T, swaps: Swaps): T {
  if (!item || typeof item !== 'object') return item;
  let out = item as Record<string, unknown>;
  for (const [key, table] of Object.entries(swaps)) {
    const v = out[key];
    if (typeof v === 'string' && Object.hasOwn(table, v)) out = { ...out, [key]: table[v] };
  }
  return out as T;
}

/** Saved content with every leftover piece of retired built-in wording replaced. */
export function retireOldWording(o: Partial<SiteContent>): Partial<SiteContent> {
  const out: Record<string, unknown> = { ...o };

  for (const [section, swaps] of Object.entries(OBJECTS)) {
    if (out[section]) out[section] = swapFields(out[section], swaps);
  }

  for (const [section, swaps] of Object.entries(LISTS)) {
    const saved = out[section];
    if (Array.isArray(saved)) out[section] = saved.map((item) => swapFields(item, swaps));
  }

  if (o.pageHeaders && typeof o.pageHeaders === 'object') {
    out.pageHeaders = Object.fromEntries(
      Object.entries(o.pageHeaders).map(([page, header]) => [
        page,
        PAGE_HEADERS[page] ? swapFields(header, PAGE_HEADERS[page]) : header,
      ]),
    );
  }

  return out as Partial<SiteContent>;
}
