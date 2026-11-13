import type { t } from "../../../val.config";
import type { quoteSection } from "../../routes/_site.landing.val";

export type QuoteSectionProps = t.inferSchema<typeof quoteSection>;

export default function QuoteSection({
  quote,
  attribution,
}: QuoteSectionProps) {
  return (
    <section style={{ padding: "2rem 1.5rem" }}>
      <blockquote
        style={{ margin: 0, fontSize: "1.5rem", fontStyle: "italic" }}
      >
        “{quote}”
      </blockquote>
      <cite
        style={{
          display: "block",
          marginTop: "0.75rem",
          color: "var(--muted)",
        }}
      >
        {attribution}
      </cite>
    </section>
  );
}
