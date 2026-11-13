import { Link } from "@tanstack/react-router";
import type { t } from "../../../val.config";
import { val } from "../../../val.config";
import type { callToActionFields } from "../../routes/_site.landing.val";

export type CallToActionProps = t.inferSchema<typeof callToActionFields>;

/** The page's closing line: one object, rendered by its own component. */
export default function CallToAction({ text, label, href }: CallToActionProps) {
  return (
    <section
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "1.5rem",
      }}
    >
      <p style={{ margin: 0 }}>{text}</p>
      {/* A route goes into a URL: the raw string, with no edit tag in it */}
      <Link to={val.raw(href)} style={{ fontWeight: 600 }}>
        {label}
      </Link>
    </section>
  );
}
