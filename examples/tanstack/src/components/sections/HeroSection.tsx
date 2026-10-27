import type { t } from "../../../val.config";
import type { heroSection } from "../../routes/_site.landing.val";

export type HeroSectionProps = t.inferSchema<typeof heroSection>;

/**
 * An ordinary component: its props are what `useVal` returns for the schema.
 * `_site.landing.val.ts` points at this file with a lazy `import()`, so Val
 * never loads it outside of the app.
 */
export default function HeroSection({
  title,
  tagline,
  bullets,
}: HeroSectionProps) {
  return (
    <section
      style={{ display: "grid", gap: "0.75rem", padding: "2rem 1.5rem" }}
    >
      <h1 style={{ fontSize: "2.25rem", lineHeight: 1.1, margin: 0 }}>
        {title}
      </h1>
      <p style={{ margin: 0, color: "var(--muted)" }}>{tagline}</p>
      <ul style={{ margin: 0 }}>
        {bullets.map((bullet, i) => (
          <li key={i}>{bullet}</li>
        ))}
      </ul>
    </section>
  );
}
