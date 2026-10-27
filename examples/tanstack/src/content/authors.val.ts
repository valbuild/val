import { s, c, type t } from "../../val.config";
import galleryVal from "./gallery.val";

/**
 * The authors every other module points at with `s.keyOf(authorsVal)`.
 *
 * A RECORD, so its keys are content: they are what a reference stores, and
 * renaming one is a change the Studio has to carry into everything referring to
 * it. Written as the two-argument `s.record(key, item)` so the KEY can carry a
 * description of its own — shown in every form that asks for one ("New entry",
 * "Rename key", "Duplicate"), which is the only place a key is ever typed.
 */
export const authorSchema = s
  .object({
    name: s
      .string()
      .minLength(2)
      .describe("Shown wherever the author is credited"),
    title: s.string().describe("Role or affiliation"),
    /**
     * `.validate()`: a custom rule, as a closure on the schema.
     *
     * It returns `false` for "fine" and a MESSAGE for "not fine", which reads
     * backwards for about a minute and then never again — there is nothing to
     * say when a value is valid.
     */
    email: s
      .string()
      .nullable()
      .validate((src) =>
        src === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(src)
          ? false
          : `'${src}' is not an email address`,
      )
      .describe("Optional. Checked by a custom validator"),
    /** `s.enum()`: a string with a closed domain, drawn as a dropdown. */
    status: s.enum("active", "emeritus", "guest"),
    /** `s.date()`: a calendar date, `YYYY-MM-DD`, with an allowed range. */
    joined: s
      .date()
      .from("2000-01-01")
      .to("2030-12-31")
      .describe("When they first wrote something here"),
    /** A gallery-backed image: the path is all that is stored here. */
    portrait: s.image(galleryVal).nullable(),
    bio: s.richtext({ bold: true, italic: true, a: true }).nullable(),
  })
  /**
   * `.preview()` is a NAME: it says how this value is shown wherever it is
   * REFERRED to rather than edited — a row of this record, a search hit, the
   * reference dropdown that `s.keyOf` draws. It is declared on the schema of
   * the value being previewed, and the container reifies its rows from it.
   */
  .preview(({ val }) => ({
    title: val.name,
    subtitle: val.title,
    image: val.portrait,
  }));

export type Author = t.inferSchema<typeof authorSchema>;

export default c.define(
  "/src/content/authors.val.ts",
  s.record(
    s
      .string()
      .describe("A short handle. Lower case, no spaces — it is the reference"),
    authorSchema,
  ),
  {
    freekh: {
      name: "Fredrik Ekholdt",
      title: "Val",
      email: "fredrik@example.com",
      status: "active",
      joined: "2023-01-09",
      portrait: { path: "/public/val/gallery/brand-blue_9e87d.png" },
      bio: [
        {
          tag: "p",
          children: [
            "Writes the ",
            { tag: "span", styles: ["bold"], children: ["schemas"] },
            " that everything else reads.",
          ],
        },
      ],
    },
    ada: {
      name: "Ada Lovelace",
      title: "Analytical Engine",
      email: null,
      status: "emeritus",
      joined: "2023-06-01",
      portrait: { path: "/public/val/gallery/accent-amber_37f8b.png" },
      bio: null,
    },
  },
);
