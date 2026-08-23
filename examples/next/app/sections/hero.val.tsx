import { s, c, type t } from "../../val.config";

/**
 * The schema of this section.
 *
 * It is exported so that content modules can embed this exact schema (see
 * content/pages.val.ts). That is what lets Val find every place the section is
 * used and preview the component with that place's content.
 *
 * The `type` literal is what makes it usable in a discriminated union of
 * sections - and it has to be part of the schema the component module uses, or
 * the union member would not be the same schema.
 */
export const schema = s.object({
  type: s.literal("hero"),
  title: s.string().minLength(2),
  tagline: s.string(),
  bullets: s.array(s.string()),
  cta: s.object({
    label: s.string(),
    href: s.string(),
  }),
});

export type HeroSectionProps = t.inferSchema<typeof schema>;

/**
 * An ordinary React component: the props are exactly what `fetchVal` / `useVal`
 * return for this schema. Rewrite this freely (by hand or with AI) and the
 * preview in the Val UI updates on the next reload.
 */
export function HeroSection({
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

/**
 * Default content: deliberately not representative of any real page. Long
 * values and a long list are what make layout problems obvious, which is the
 * point of having a fixture in addition to the real usages.
 */
export default c.component("/app/sections/hero.val.tsx", HeroSection, schema, {
  type: "hero",
  title:
    "A deliberately very long headline that should still wrap and not overflow",
  tagline:
    "A tagline that is also longer than anything an editor would realistically write, so that the layout gets stress tested.",
  bullets: [
    "A short one",
    "A considerably longer bullet point that runs onto a second line",
    "Another",
    "And another",
    "And one more, to check the spacing of a long list",
  ],
  cta: {
    label: "A call to action with a long label",
    href: "https://val.build",
  },
});
