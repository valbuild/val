import { c, s } from "../../../../val.config";

export default c.define(
  "/app/[locale]/blog/[blog]/translations.val.ts",
  s
    .record(
      s.object({
        "en-us": s.string(),
        "nb-no": s.string(),
        "translation-is-available-in": s.string(),
      }),
    )
    .keys({ locale: { required: ["en-us", "nb-no"] } }),
  {
    "en-us": {
      "en-us": "English",
      "nb-no": "Norwegian",
      "translation-is-available-in":
        "This blog is also available in the following languages:",
    },
    "nb-no": {
      "en-us": "Engelsk",
      "nb-no": "Norsk",
      "translation-is-available-in":
        "Denne bloggen er også tilgjengelig på følgende språk:",
    },
  },
);
