import { ValComponentEditor } from "@valbuild/tanstack";
import type { t } from "../../../val.config";
import type { columnsFields } from "../../routes/_site.landing.val";

export type ColumnsSectionProps = t.inferSchema<typeof columnsFields>;

/**
 * A section with components inside it. Its `cards` are linked to a component
 * of their own, so they are handed to a `ValComponentEditor` here exactly as
 * the page hands it the sections - and can be arranged on the page too.
 */
export default function ColumnsSection({
  heading,
  cards,
}: ColumnsSectionProps) {
  return (
    <section style={{ padding: "2rem 1.5rem" }}>
      <h2 style={{ margin: "0 0 1rem", fontSize: "1.5rem" }}>{heading}</h2>
      <ValComponentEditor value={cards} className="landing-cards" />
    </section>
  );
}
