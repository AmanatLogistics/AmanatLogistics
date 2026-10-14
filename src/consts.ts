/**
 * Amanat Logistics — central content & config.
 * Edit values here and they update across the whole site.
 * (Non-technical friendly: change a phone number in ONE place.)
 */

export const SITE = {
  name: 'Amanat Logistics',
  tagline: 'Kandahar · Afghanistan',
  domain: 'https://amanatlogistics.com',
  description:
    'Freight forwarding, customs clearance and cargo logistics from Kandahar, Afghanistan — road, air and sea freight to markets worldwide, plus global personal shopping.',
};

export const CONTACT = {
  phoneExport: '+93 70 009 8848',
  phoneShopping: '+93 70 684 0090',
  email: 'info@amanatlogistics.com',
  location: 'Kandahar, Afghanistan',
  // Where the quote form delivers to. Change if you route inquiries elsewhere.
  inboxEmail: 'info@amanatlogistics.com',
};

export const NAV = [
  { label: 'Home', href: '/' },
  { label: 'About', href: '/about' },
  { label: 'Services', href: '/services' },
  { label: 'Routes & Coverage', href: '/routes' },
  { label: 'Track Shipment', href: '/tracking' },
  { label: 'Gallery', href: '/gallery' },
  { label: 'Contact', href: '/contact' },
];

// Home — trust stats bar. Replace with real numbers when confirmed.
export const STATS = [
  { value: '500+', label: 'Tons Delivered' },
  { value: '1,200+', label: 'Shipments Completed' },
  { value: '4', label: 'Countries Served' },
  // Was "Since 20XX" — placeholder text that reached the live homepage. No
  // founding year is stated anywhere in this project and inventing one would be
  // worse than not showing it, so this says something true instead. Set a real
  // year here, or in /admin → Trust numbers, whenever you want it back.
  { value: 'Road · Air · Sea', label: 'Freight Modes' },
];

export const EXPORTS = [
  { name: 'Figs', img: '/images/exports/figs.jpg', alt: 'Premium dried Kandahari figs' },
  { name: 'Dried Fruits', img: '/images/exports/dried-fruits.jpg', alt: 'Afghan raisins and apricots' },
  { name: 'Fresh Fruits', img: '/images/exports/fresh-fruits.jpg', alt: 'Fresh pomegranates and grapes' },
  { name: 'Nuts', img: '/images/exports/nuts.jpg', alt: 'Almonds and pine nuts' },
  { name: 'Other Produce', img: '/images/exports/other.jpg', alt: 'Seasonal Afghan specialties' },
];

export const DESTINATIONS = [
  { name: 'India', mode: 'Air & land freight', delivers: 'Dry fruit · fresh produce · general cargo' },
  { name: 'Canada', mode: 'Air & sea freight', delivers: 'Dry fruit · nuts · general cargo' },
  { name: 'United Kingdom', mode: 'Air & sea freight', delivers: 'Dry fruit · fresh produce · general cargo' },
  { name: 'United States', mode: 'Air & sea freight', delivers: 'Dry fruit · nuts · general cargo' },
];

export const VALUES = [
  { title: 'Accountability', line: 'One team answerable for your cargo, from pickup to delivery.', bg: '#F0E4CC', dot: '#B08A48' },
  { title: 'Care', line: 'Careful handling, packing and storage on every consignment, perishables included.', bg: '#EFE0E9', dot: '#8C5A2B' },
  { title: 'Reliability', line: 'Documented, tracked shipments that arrive exactly as promised.', bg: '#E5EADB', dot: '#43503A' },
  { title: 'Global Reach', line: 'Established corridors across three continents, growing steadily.', bg: '#F3E1D6', dot: '#7A3B2E' },
];

// Upload real photos in /admin → Team members (they show a placeholder until then).
export const TEAM = [
  { name: 'Founder Name', role: 'Founder & Managing Director', img: '' },
  { name: 'Team Member', role: 'Head of Export Operations', img: '' },
];

export const GALLERY = [
  { cat: 'Products', img: '/images/gallery/figs.jpg', alt: 'Dried figs product photo', h: 300 },
  { cat: 'Warehouse & Storage', img: '/images/gallery/warehouse.jpg', alt: 'Warehouse storage stacked cartons', h: 220 },
  { cat: 'Shipments', img: '/images/gallery/loading.jpg', alt: 'Cargo loading shipment', h: 260 },
  { cat: 'Products', img: '/images/gallery/raisins.jpg', alt: 'Raisins and apricots product photo', h: 230 },
  { cat: 'Products', img: '/images/gallery/nuts.jpg', alt: 'Almonds and pine nuts', h: 300 },
  { cat: 'Warehouse & Storage', img: '/images/gallery/packing.jpg', alt: 'Grading and packing line', h: 270 },
  { cat: 'Shipments', img: '/images/gallery/pallets.jpg', alt: 'Pallets ready for export', h: 210 },
  { cat: 'Products', img: '/images/gallery/pomegranates.jpg', alt: 'Fresh pomegranates at harvest', h: 260 },
  { cat: 'Warehouse & Storage', img: '/images/gallery/cold-storage.jpg', alt: 'Cold-storage room interior', h: 240 },
  { cat: 'Shipments', img: '/images/gallery/truck.jpg', alt: 'Truck convoy air cargo hold', h: 300 },
  { cat: 'Products', img: '/images/gallery/boxes.jpg', alt: 'Packaged retail-ready fig boxes', h: 220 },
  { cat: 'Shipments', img: '/images/gallery/container.jpg', alt: 'Container being sealed at port', h: 250 },
];

export const GALLERY_CATS = ['All', 'Products', 'Warehouse & Storage', 'Shipments'];

// Personal Shopping — stores we buy from on your behalf.
// Drop a logo file at `img` (see /public/images/platforms) and it shows automatically;
// until then the store name shows as text.
export const PLATFORMS = [
  { name: 'Amazon', img: '/images/platforms/amazon.png' },
  { name: 'Daraz', img: '/images/platforms/daraz.webp' },
  { name: 'AliExpress', img: '/images/platforms/aliexpress.png' },
  { name: 'LAAM', img: '/images/platforms/laam.png' },
];

/* ============================================================
   Editable content — defaults for everything the admin panel
   (/admin) can change without code. Saved edits override these.
   ============================================================ */
export const DEFAULT_CONTENT = {
  // Your real logo — upload in /admin under "Logo & brand".
  // When set, it replaces the built-in swallow mark across the site.
  brand: {
    logo: '/images/brand-logo.png', // colour version, shown on the light header
    logoLight: '/images/brand-logo-white.png', // white version, shown on the dark footer
  },
  hero: {
    eyebrow: 'Freight & Logistics · Kandahar, Afghanistan',
    title: 'Freight, Customs & Logistics, From Kandahar to the World.',
    subtitle:
      'Road, air and sea freight, customs clearance and export documents — handled end to end by one accountable team, so your cargo arrives as promised.',
    // A cargo photo rather than the old figs one: the headline is about freight now.
    // Upload a wider photo (2400px+) in /admin → Home page — hero for a sharper banner.
    image: '/images/gallery/loading.jpg',
  },
  // Search-engine / social preview text + image
  seo: {
    description:
      'Freight forwarding, customs clearance and cargo logistics from Kandahar, Afghanistan — road, air and sea freight to markets worldwide, plus global personal shopping.',
    ogImage: '/images/og-image.jpg',
  },
  // Decorative photos used across inner pages
  images: {
    aboutHeader: '/images/about-header.jpg',
    // Was an orchard photo, from when the site sold fruit; a logistics company
    // tells its story better with cargo on the move.
    aboutStory: '/images/gallery/container.jpg',
    // Routes now draw a built-in vector map (RouteMap.astro); upload a graphic
    // here only if you want to replace it with your own artwork.
    worldMap: '',
  },
  // Coloured header band on each inner page
  pageHeaders: {
    services: { eyebrow: 'What We Do', title: 'Our Services', subtitle: 'Freight forwarding, customs clearance and cargo handling from Kandahar to ports worldwide — and from global marketplaces back to your door. Two services, delivered with the same standard of trust.' },
    about: { eyebrow: 'Our Story', title: 'About Amanat Logistics', subtitle: "A Kandahar-based logistics company moving Afghanistan's trade across borders — with a name that means trust." },
    routes: { eyebrow: 'Where We Ship', title: 'Routes & Coverage', subtitle: 'Established freight corridors from Kandahar to markets across three continents — with new destinations added as our partnerships grow.' },
    gallery: { eyebrow: 'Our Work in Pictures', title: 'Gallery', subtitle: 'The cargo we carry, our facilities, and our shipments — real photography builds real trust.' },
    contact: { eyebrow: 'Get In Touch', title: 'Contact Us', subtitle: 'Reach the right team directly, or send a detailed quote request below. Exporters, importers, traders, and officials are always welcome.' },
    tracking: { eyebrow: 'Shipment Tracking', title: 'Track Your Shipment', subtitle: 'Enter your tracking number or invoice number to follow your consignment from our Kandahar warehouse right through to delivery.' },
  },
  // Services page — three freight-mode cards
  freightModes: [
    { title: 'Sea Freight', text: 'Cost-efficient bulk shipping for large consignments, with full-container and consolidated options through regional ports.' },
    { title: 'Air Freight', text: 'Fast, temperature-aware air cargo for perishables, samples and priority shipments — days from Kandahar to your airport.' },
    { title: 'Land / Road Freight', text: 'Regional overland corridors to neighboring markets, with customs brokerage at both borders.' },
  ],
  // Services page — Global Personal Shopping block (intro + photo)
  shopping: {
    description:
      "Want a product sold online but can't order it yourself? Simply send us a product link or a screenshot from Amazon, Daraz, or any other online store. Amanat places the order on your behalf, consolidates it, and delivers it to you — with clear, itemized pricing and no hidden fees.",
    image: '/images/shopping-parcels.jpg',
  },
  // Services page — Global Personal Shopping 3-step flow
  shoppingSteps: [
    { title: 'Send us the link or screenshot', text: 'Share the product page or a screenshot from Amazon, Daraz, or any store.' },
    { title: 'We place the order', text: 'We purchase and consolidate your items, confirming every cost up front.' },
    { title: 'We deliver to you', text: 'Tracked delivery to your door, with updates the whole way.' },
  ],
  stats: STATS,
  contact: CONTACT,
  exports: EXPORTS,
  destinations: DESTINATIONS,
  gallery: GALLERY,
  team: TEAM,
  platforms: PLATFORMS,
  // Two service cards (Home page + Services page intros)
  services: {
    exportTitle: 'Freight & Logistics',
    exportText:
      'Road, air and sea freight out of Afghanistan, with customs clearance, export documents and careful cargo handling at every step — from pickup to delivery.',
    shoppingTitle: 'Global Personal Shopping',
    shoppingText:
      'We order products from Amazon, Daraz & more on your behalf — purchased, consolidated, and delivered to your door with transparent, itemized pricing.',
  },
  // "Why Amanat" cards on the Home page
  why: [
    { title: 'Customs & paperwork handled', text: 'Declarations, certificates and export documents prepared and checked, so cargo is not held at the border.' },
    { title: 'Secure end-to-end shipping', text: 'Careful packing, customs handling, and tracked freight from our facility to your port.' },
    { title: 'Reliable partnership', text: 'A single accountable partner for exporters, importers, traders, and officials.' },
  ],
  // Home page — the partnership with Faiz Fayez LTD, the Kandahar fruit
  // traders whose consignments Amanat carries. Their site (faizfayezltd.com)
  // names Amanat as its logistics partner; this is the same partnership seen
  // from this side. Set "show" to Hide in /admin to take it off the page.
  partner: {
    show: 'Show',
    eyebrow: 'Our trade partner',
    title: 'In partnership with Faiz Fayez LTD',
    text: 'Faiz Fayez LTD trades dry and fresh fruit out of Kandahar. We carry their consignments to buyers abroad: road, air and sea freight, customs clearance and export papers, handled together from their warehouse to delivery.',
    name: 'Faiz Fayez LTD',
    role: 'Dry & fresh fruit traders',
    since: '2025',
    link: 'https://faizfayezltd.com/',
    button: 'Visit Faiz Fayez LTD',
    // Leave empty for the built-in "FF" monogram in their colours.
    logo: '',
  },
  // Figures beside the partnership band. The first one is shown largest.
  partnerStats: [
    { value: '2,700', label: 'Tons shipped together' },
    { value: '1,200', label: 'Tons of dried figs' },
    { value: '850', label: 'Tons of raisins' },
    { value: '650', label: 'Tons of pomegranates' },
  ],
  // "What we do" cards on the Home page (icons stay fixed by position)
  logistics: [
    { title: 'Road Freight', text: 'Overland trucking along regional corridors, with border crossings and transit papers arranged for you.' },
    { title: 'Air Cargo', text: 'Fast air freight for perishables, samples and urgent consignments — booked, palletised and loaded for you.' },
    { title: 'Sea Freight', text: 'Full-container and consolidated shipments for bulk cargo, routed through regional ports.' },
    { title: 'Customs Clearance', text: 'Declarations and clearance at origin and at the border, so your cargo keeps moving.' },
    { title: 'Export Documents', text: 'Invoices, packing lists, certificates of origin and phytosanitary papers, prepared and checked.' },
    { title: 'Warehousing & Handling', text: 'Storage, packing, palletising and loading at our Kandahar facility, perishables included.' },
  ],
  // Mission & Values cards on the About page (colors stay fixed by position)
  values: VALUES.map(({ title, line }) => ({ title, line })),
  // About page story paragraphs
  about: {
    p1: "Amanat Logistics was founded in Kandahar to solve a simple problem: Afghan goods are in demand abroad, but getting them there — through borders, customs, airports and ports — is hard. We built a logistics company to do that part properly, so traders can focus on their trade.",
    p2: '"Amanat" means a trust — something precious placed in your safekeeping. That word guides everything we do. We arrange the freight, prepare the export documents, clear customs, and handle the cargo at our own facilities, so our clients deal with one accountable company built on honesty and consistency.',
    p3: "Today we move cargo for exporters, importers, and officials across several continents — from Kandahar's dry fruit and fresh produce to general cargo — and we track every consignment until it arrives.",
  },
};

export type SiteContent = typeof DEFAULT_CONTENT;
