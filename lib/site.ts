// Verified public business details, shared by the website, metadata and schema.
export const SITE = {
  name: "D&M Painting & Decorating",
  url: "https://www.dmpaintingdecorating.co.uk",
  email: "info@dmpaintingdecorating.co.uk",
  whatsapp: "447449255082",
  // Leave empty until Mike confirms a number customers may call. When set
  // (e.g. "01925 000000"), click-to-call links and schema telephone appear.
  phone: "",
  tagline: "Preparation first. Quality always.",
  ogImage: { url: "/og-image.png", width: 1200, height: 630, alt: "D&M Painting & Decorating — preparation-led painters and decorators in Warrington and South Manchester" },
} as const;

export const whatsappHref = `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent("Hi D&M, I'd like to enquire about some painting and decorating.")}`;
export const telHref = (phone: string) => "tel:" + phone.replace(/[^\d+]/g, "").replace(/^0/, "+44");
