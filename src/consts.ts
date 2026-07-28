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
