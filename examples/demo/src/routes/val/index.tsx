import { createFileRoute, redirect } from "@tanstack/react-router";
import { isDemo } from "../../demo";

/**
 * Where the demo starts: the home page, with the page itself open beside its
 * fields. A first visit should land on something to edit, not on a list of
 * modules -- and the tour's second stop is the page.
 */
const DEMO_START = `/val/~/src/routes/_site.index.val.ts?p=${encodeURIComponent(
  JSON.stringify("/"),
)}&canvas=1`;

// `/val` itself. The layout beside this file is the whole page.
export const Route = createFileRoute("/val/")({
  beforeLoad: () => {
    if (isDemo) {
      throw redirect({ href: DEMO_START });
    }
  },
  component: () => null,
});
