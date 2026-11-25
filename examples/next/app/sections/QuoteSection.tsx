import type { t } from "../../val.config";
import type { quoteFields } from "../../content/pages.val";

export type QuoteSectionProps = t.inferSchema<typeof quoteFields>;

export default function QuoteSection({
  quote,
  attribution,
}: QuoteSectionProps) {
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
