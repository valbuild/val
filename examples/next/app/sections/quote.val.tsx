import { s, c, type t } from "../../val.config";

export const schema = s.object({
  type: s.literal("quote"),
  quote: s.string(),
  attribution: s.string(),
});

export type QuoteSectionProps = t.inferSchema<typeof schema>;

export function QuoteSection({ quote, attribution }: QuoteSectionProps) {
  return (
    <section
      style={{
        padding: "3rem 2rem",
        fontFamily: "system-ui, sans-serif",
        color: "#0c111d",
        background: "#f7f7f8",
      }}
    >
      <blockquote
        style={{ margin: 0, fontSize: "1.5rem", fontStyle: "italic" }}
      >
        “{quote}”
      </blockquote>
      <cite style={{ display: "block", marginTop: "1rem", opacity: 0.7 }}>
        {attribution}
      </cite>
    </section>
  );
}

/**
 * No default content: this section is used in content, so the preview shows it
 * with the content of each real usage. Omitting it means the module falls back
 * to the emptiest value the schema accepts.
 */
export default c.component("/app/sections/quote.val.tsx", QuoteSection, schema);
