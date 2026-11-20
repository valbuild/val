import { createFileRoute } from "@tanstack/react-router";
import { ValRichText } from "@valbuild/tanstack";
import { useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import pageVal from "./_site.generic.$.val";

/**
 * An e2e fixture, not part of the showcase: the Next example's
 * `app/generic/[[...path]]`. Its module is registered only with
 * `VAL_E2E_FIXTURES`; see `val.modules.ts`.
 *
 * A splat, and in TanStack a splat is OPTIONAL: this route serves `/generic`
 * itself (with an empty `_splat`) as well as `/generic/test/foo`, which is
 * what Next's `[[...path]]` does, so the one module holds both keys.
 */
export const Route = createFileRoute("/_site/generic/$")({
  component: GenericPage,
});

function GenericPage() {
  const content = useValRoute(pageVal, Route.useParams());
  // Returned rather than thrown — see the note in _site.index.tsx.
  if (!content) {
    return <NotFound />;
  }
  return (
    <main>
      <h1>{content.title}</h1>
      {content.sections.map((section, index) =>
        section.type === "text" ? (
          <ValRichText key={index} content={section.text} />
        ) : (
          <pre key={index}>{section.code}</pre>
        ),
      )}
    </main>
  );
}
