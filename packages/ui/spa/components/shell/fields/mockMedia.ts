import { FileEntry, ImageEntry, MediaFolder } from "./types";

/**
 * Stand-in media for the field stories.
 *
 * The images are inline SVG rather than files or remote URLs: a story that
 * fetches anything is a story that breaks on a plane, and the hotspot design
 * needs pictures whose subject is somewhere other than the middle — which is
 * hard to guarantee with stock photos and trivial to draw.
 */

/** An SVG "photograph": a sky, a horizon, and a subject where we want one. */
function photo(options: {
  sky: [string, string];
  ground: string;
  subject: string;
  /** Where the subject sits, 0–1 across and down. */
  at: { x: number; y: number };
  horizon: number;
  width: number;
  height: number;
}): string {
  const { sky, ground, subject, at, horizon, width, height } = options;
  const cx = Math.round(at.x * width);
  const cy = Math.round(at.y * height);
  const r = Math.round(Math.min(width, height) * 0.07);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/>
  </linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#s)"/>
  <path d="M0 ${horizon * height} L${width * 0.28} ${horizon * height - height * 0.16} L${width * 0.46} ${horizon * height} L${width * 0.68} ${horizon * height - height * 0.22} L${width} ${horizon * height} Z" fill="${ground}" opacity="0.55"/>
  <rect y="${horizon * height}" width="${width}" height="${height}" fill="${ground}"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${subject}"/>
  <rect x="${cx - r * 0.6}" y="${cy}" width="${r * 1.2}" height="${r * 2.2}" rx="${r * 0.5}" fill="${subject}"/>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const HERO = photo({
  sky: ["#9fc7e8", "#dcebf6"],
  ground: "#2f4858",
  subject: "#e8b13b",
  // Off-centre and low, so a square crop of the middle would cut the subject
  // in half — which is the case a hotspot exists to fix.
  at: { x: 0.34, y: 0.72 },
  horizon: 0.62,
  width: 2400,
  height: 1600,
});

const TEAM = photo({
  sky: ["#e7ded2", "#f6f1ea"],
  ground: "#8d7b66",
  subject: "#3c6e57",
  at: { x: 0.62, y: 0.55 },
  horizon: 0.5,
  width: 1920,
  height: 1280,
});

const OFFICE = photo({
  sky: ["#cfd8e3", "#eef2f6"],
  ground: "#4a5a6a",
  subject: "#b45f3f",
  at: { x: 0.5, y: 0.44 },
  horizon: 0.7,
  width: 1920,
  height: 1280,
});

const PRODUCT = photo({
  sky: ["#f2e6e6", "#faf3f3"],
  ground: "#7a5c5c",
  subject: "#2f4858",
  at: { x: 0.24, y: 0.5 },
  horizon: 0.66,
  width: 1600,
  height: 1600,
});

export const mockImage: ImageEntry = {
  kind: "image",
  ref: "/public/val/images/hero-mountains_a1b2c.jpg",
  name: "hero-mountains_a1b2c.jpg",
  url: HERO,
  width: 2400,
  height: 1600,
  mimeType: "image/jpeg",
  size: 1_258_291,
  alt: "Person looking at mountains and lake",
  hotspot: { x: 0.34, y: 0.72 },
};

export const mockImages: ImageEntry[] = [
  mockImage,
  {
    kind: "image",
    ref: "/public/val/images/team-working_d4e5f.jpg",
    name: "team-working_d4e5f.jpg",
    url: TEAM,
    width: 1920,
    height: 1280,
    mimeType: "image/jpeg",
    size: 842_137,
    alt: "Two people at a shared desk",
  },
  {
    kind: "image",
    ref: "/public/val/images/office_88a01.jpg",
    name: "office_88a01.jpg",
    url: OFFICE,
    width: 1920,
    height: 1280,
    mimeType: "image/jpeg",
    size: 764_221,
    alt: null,
  },
  {
    kind: "image",
    ref: "/public/val/images/product-shot_0c1d2.png",
    name: "product-shot_0c1d2.png",
    url: PRODUCT,
    width: 1600,
    height: 1600,
    mimeType: "image/png",
    size: 2_104_887,
    alt: "The product on a plain background",
    hotspot: { x: 0.24, y: 0.5 },
  },
];

export const mockFile: FileEntry = {
  kind: "file",
  ref: "/public/val/files/brand-guidelines_9f21c.pdf",
  name: "brand-guidelines_9f21c.pdf",
  mimeType: "application/pdf",
  size: 1_887_436,
};

export const mockFiles: FileEntry[] = [
  mockFile,
  {
    kind: "file",
    ref: "/public/val/files/case-study-northwind_3ab77.docx",
    name: "case-study-northwind_3ab77.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 327_680,
  },
  {
    kind: "file",
    ref: "/public/val/files/pricing_c05e9.xlsx",
    name: "pricing_c05e9.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 100_352,
  },
  {
    kind: "file",
    ref: "/public/val/files/logos_f00dc.zip",
    name: "logos_f00dc.zip",
    mimeType: "application/zip",
    size: 13_002_342,
  },
  {
    kind: "file",
    ref: "/public/val/files/investor-deck_71bd3.pptx",
    name: "investor-deck_71bd3.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    size: 9_122_611,
  },
  {
    kind: "file",
    ref: "/public/val/files/readme_5c9e0.txt",
    name: "readme_5c9e0.txt",
    mimeType: "text/plain",
    size: 2_048,
  },
];

export const mockImageFolders: MediaFolder[] = [
  { path: "/public/val/images/marketing", name: "marketing", itemCount: 24 },
  { path: "/public/val/images/blog", name: "blog", itemCount: 61 },
  { path: "/public/val/images/product", name: "product", itemCount: 12 },
];

export const mockFileFolders: MediaFolder[] = [
  { path: "/public/val/files/legal", name: "legal", itemCount: 7 },
  { path: "/public/val/files/press", name: "press", itemCount: 15 },
];
