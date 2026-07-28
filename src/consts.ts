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
    'Premium figs & dry fruits, from Kandahar to the world — exported with integrity, delivered with care. Export & freight plus global personal shopping.',
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
  { label: 'Gallery', href: '/gallery' },
  { label: 'Contact', href: '/contact' },
];

// Home — trust stats bar. Replace with real numbers when confirmed.
export const STATS = [
  { value: '500+', label: 'Tons Delivered' },
  { value: '1,200+', label: 'Orders Completed' },
  { value: '4', label: 'Countries Served' },
  { value: 'Since 20XX', label: 'Serving With Trust' },
];

export const EXPORTS = [
  { name: 'Figs', img: '/images/exports/figs.jpg', alt: 'Premium dried Kandahari figs' },
  { name: 'Dried Fruits', img: '/images/exports/dried-fruits.jpg', alt: 'Afghan raisins and apricots' },
  { name: 'Fresh Fruits', img: '/images/exports/fresh-fruits.jpg', alt: 'Fresh pomegranates and grapes' },
  { name: 'Nuts', img: '/images/exports/nuts.jpg', alt: 'Almonds and pine nuts' },
  { name: 'Other Produce', img: '/images/exports/other.jpg', alt: 'Seasonal Afghan specialties' },
];

export const DESTINATIONS = [
  { name: 'India', mode: 'Air & land freight', delivers: 'Figs · dry fruits · fresh produce' },
  { name: 'Canada', mode: 'Air & sea freight', delivers: 'Figs · dry fruits · nuts' },
  { name: 'United Kingdom', mode: 'Air & sea freight', delivers: 'Figs · dry fruits · fresh produce' },
  { name: 'United States', mode: 'Air & sea freight', delivers: 'Figs · dry fruits · nuts' },
];

export const VALUES = [
  { title: 'Authenticity', line: "Genuine Afghan origin, sourced directly from Kandahar's growers.", bg: '#F0E4CC', dot: '#B08A48' },
  { title: 'Quality', line: 'Consistent grading and food-safe handling on every consignment.', bg: '#EFE0E9', dot: '#8C5A2B' },
  { title: 'Reliability', line: 'Documented, tracked shipments that arrive exactly as promised.', bg: '#E5EADB', dot: '#43503A' },
  { title: 'Global Reach', line: 'Established corridors across three continents, growing steadily.', bg: '#F3E1D6', dot: '#7A3B2E' },
];

export const TEAM = [
  { name: 'Founder Name', role: 'Founder & Managing Director', img: '/images/team/founder.jpg' },
  { name: 'Team Member', role: 'Head of Export Operations', img: '/images/team/ops.jpg' },
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
    eyebrow: 'Kandahar, Afghanistan',
    title: 'Premium Figs & Dry Fruits, From Kandahar to the World.',
    subtitle:
      "Trusted export and freight partner delivering Afghanistan's finest produce across the globe.",
    image: '/images/hero-home.jpg',
  },
  // Search-engine / social preview text + image
  seo: {
    description:
      'Premium figs & dry fruits, from Kandahar to the world — exported with integrity, delivered with care. Export & freight plus global personal shopping.',
    ogImage: '/images/og-image.jpg',
  },
  // Decorative photos used across inner pages
  images: {
    aboutHeader: '/images/about-header.jpg',
    aboutStory: '/images/about-story.jpg',
    worldMap: '/images/routes-worldmap.svg',
  },
  // Coloured header band on each inner page
  pageHeaders: {
    services: { eyebrow: 'What We Do', title: 'Our Services', subtitle: "From Kandahar's orchards to ports worldwide — and from global marketplaces back to your door. Two services, delivered with the same standard of trust." },
    about: { eyebrow: 'Our Story', title: 'About Amanat Logistics', subtitle: "A Kandahar-rooted company carrying Afghanistan's finest produce to the world — with a name that means trust." },
    routes: { eyebrow: 'Where We Ship', title: 'Routes & Coverage', subtitle: 'Established export corridors from Kandahar to markets across three continents — with new destinations added as our partnerships grow.' },
    gallery: { eyebrow: 'Our Work in Pictures', title: 'Gallery', subtitle: 'Our products, our facilities, and our shipments — real photography builds real trust.' },
    contact: { eyebrow: 'Get In Touch', title: 'Contact Us', subtitle: 'Reach the right team directly, or send a detailed quote request below. Serious inquiries from importers, distributors, and officials are always welcome.' },
  },
  // Services page — three freight-mode cards
  freightModes: [
    { title: 'Sea Freight', text: 'Cost-efficient bulk shipping for large dry-fruit consignments, with full container and consolidated options.' },
    { title: 'Air Freight', text: 'Fast, temperature-aware shipping for fresh fruit and priority orders — days from Kandahar to your port.' },
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
    exportTitle: 'Export & Freight',
    exportText:
      'Premium figs, dry fruits, and fresh fruits from Afghanistan — shipped by sea, air, and land with certified documentation and careful handling at every step.',
    shoppingTitle: 'Global Personal Shopping',
    shoppingText:
      'We order products from Amazon, Daraz & more on your behalf — purchased, consolidated, and delivered to your door with transparent, itemized pricing.',
  },
  // "Why Amanat" cards on the Home page
  why: [
    { title: 'Authentic Afghan origin', text: "Sourced directly from Kandahar's orchards and growers — provenance you can document." },
    { title: 'Secure end-to-end shipping', text: 'Careful packing, customs handling, and tracked freight from our facility to your port.' },
    { title: 'Reliable partnership', text: 'A single accountable partner for officials, importers, and institutional buyers.' },
  ],
  // Mission & Values cards on the About page (colors stay fixed by position)
  values: VALUES.map(({ title, line }) => ({ title, line })),
  // About page story paragraphs
  about: {
    p1: "Amanat Logistics was founded in Kandahar, in the heart of one of the world's great fruit-growing regions. For generations, our land has produced figs, raisins, almonds, and pomegranates prized across the region for their sweetness and quality. We saw an opportunity to bring that heritage to international markets — properly graded, certified, and delivered with care.",
    p2: '"Amanat" means a trust — something precious placed in your safekeeping. That word guides everything we do. We work directly with growers, control quality at our own facilities, and manage export logistics end to end, so our partners deal with one accountable company built on honesty and consistency.',
    p3: "Today we serve importers, distributors, and officials across several continents — and we're proud to represent the very best of Afghan agriculture wherever our shipments arrive.",
  },
};

export type SiteContent = typeof DEFAULT_CONTENT;
