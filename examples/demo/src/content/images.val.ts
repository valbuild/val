import { s, c } from "../../val.config";

/**
 * Every image on the site, in one gallery. Pages pick from it with
 * `s.image(imagesVal)`, so swapping a photo in the demo is choosing another.
 */
export default c.define(
  "/src/content/images.val.ts",
  s.imagedir("/public/val/images", {
    accept: "image/*",
    alt: s.string().minLength(3).describe("What the image shows"),
  }),
  {
    "/public/val/images/hero-morning_f0bcf.jpg": {
      width: 1600,
      height: 1000,
      mimeType: "image/jpeg",
      alt: "A coffee cup in warm morning light",
    },
    "/public/val/images/roastery_29a98.jpg": {
      width: 1600,
      height: 1000,
      mimeType: "image/jpeg",
      alt: "The glow of the roaster at dawn",
    },
    "/public/val/images/harvest_05126.jpg": {
      width: 1600,
      height: 1000,
      mimeType: "image/jpeg",
      alt: "Coffee hills at harvest time",
    },
    "/public/val/images/pour-over_12b5a.jpg": {
      width: 1600,
      height: 1000,
      mimeType: "image/jpeg",
      alt: "A pour-over on a grey morning",
    },
    "/public/val/images/espresso_a3b31.jpg": {
      width: 1600,
      height: 1000,
      mimeType: "image/jpeg",
      alt: "A short, dark espresso",
    },
    "/public/val/images/market_96c7a.jpg": {
      width: 1600,
      height: 1000,
      mimeType: "image/jpeg",
      alt: "Evening at the Saturday market",
    },
    "/public/val/images/avatar-ingrid_cb0af.jpg": {
      width: 480,
      height: 480,
      mimeType: "image/jpeg",
      alt: "Ingrid, smiling",
    },
    "/public/val/images/avatar-tomas_7cd04.jpg": {
      width: 480,
      height: 480,
      mimeType: "image/jpeg",
      alt: "Tomas, by the roaster",
    },
  },
);
