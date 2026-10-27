import type { t } from "../../val.config";
import type { heroSection } from "../../content/pages.val";

export type HeroSectionProps = t.inferSchema<typeof heroSection>;

/**
 * An ordinary React component: the props are exactly what `fetchVal` / `useVal`
 * return for the schema. `content/pages.val.ts` points at this file with a lazy
 * `import()`, so Val never loads it outside of the app.
 */
export default function HeroSection({
  title,
  tagline,
  bullets,
  cta,
}: HeroSectionProps) {
  return (
    <section
      style={{
        display: "grid",
        gap: "1rem",
        padding: "3rem 2rem",
        fontFamily: "system-ui, sans-serif",
        background: "linear-gradient(135deg, #f0f4ff, #ffffff)",
        color: "#0c111d",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", lineHeight: 1.1, margin: 0 }}>
        {title}
      </h1>
      <p style={{ fontSize: "1.125rem", margin: 0, opacity: 0.8 }}>{tagline}</p>
      <ul style={{ display: "grid", gap: "0.25rem", margin: 0 }}>
        {bullets.map((bullet, i) => (
          <li key={i}>{bullet}</li>
        ))}
      </ul>
      <div>
        <a
          href={cta.href}
          style={{
            display: "inline-block",
            padding: "0.75rem 1.5rem",
            borderRadius: "0.5rem",
            background: "#0c111d",
            color: "white",
            textDecoration: "none",
          }}
        >
          {cta.label}
        </a>
      </div>
    </section>
  );
}
