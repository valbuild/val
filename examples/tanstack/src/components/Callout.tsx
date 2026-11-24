/**
 * A component with props of its own, as a design system's would be: it does
 * not import Val and was not written for any schema. `_site.landing.val.ts`
 * links a section to it with a `props` function that makes these.
 */
export type CalloutProps = {
  heading: string;
  body: string;
  tone: "info" | "warning";
};

export default function Callout({ heading, body, tone }: CalloutProps) {
  return (
    <aside
      role="note"
      style={{
        margin: "1rem 1.5rem",
        padding: "1rem 1.25rem",
        borderRadius: 8,
        borderLeft: `4px solid ${tone === "warning" ? "#d97706" : "#2563eb"}`,
        background: "color-mix(in srgb, currentColor 6%, transparent)",
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.25rem" }}>
        {heading}
      </strong>
      <span>{body}</span>
    </aside>
  );
}
