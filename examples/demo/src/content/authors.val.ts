import { s, c } from "../../val.config";
import imagesVal from "./images.val";

/** The people who write the journal. Posts point here with `s.keyOf`. */
export default c.define(
  "/src/content/authors.val.ts",
  s.record(
    s.string().describe("A short id for the author. Lower case, no spaces."),
    s
      .object({
        name: s.string().minLength(2),
        role: s.string(),
        portrait: s.image(imagesVal),
      })
      .preview(({ val }) => ({
        title: val.name,
        subtitle: val.role,
        image: val.portrait,
      })),
  ),
  {
    ingrid: {
      name: "Ingrid Solberg",
      role: "Head roaster",
      portrait: { path: "/public/val/images/avatar-ingrid_cb0af.jpg" },
    },
    tomas: {
      name: "Tomas Berg",
      role: "Green coffee buyer",
      portrait: { path: "/public/val/images/avatar-tomas_7cd04.jpg" },
    },
  },
);
