import type { t } from "../../../val.config";
import type { cardFields } from "../../routes/_site.landing.val";

export type CardProps = t.inferSchema<typeof cardFields>;

/** One card of a `ColumnsSection`. */
export default function Card({ title, text }: CardProps) {
  return (
    <article
      style={{
        height: "100%",
        padding: "1rem 1.25rem",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
      }}
    >
      <h3 style={{ margin: "0 0 0.25rem", fontSize: "1.05rem" }}>{title}</h3>
      <p style={{ margin: 0, color: "var(--muted)" }}>{text}</p>
    </article>
  );
}
