import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "../styles.css?url";

/**
 * The document shell for EVERY route, Val Studio included.
 *
 * So it deliberately holds nothing of the site: no header, no `ValProvider`.
 * Those live in `_site.tsx`, the pathless layout the site's own pages sit
 * under, which is what keeps them off `/val` — the Studio is a full-screen app
 * and should not be rendered inside the site it is editing.
 */
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Val + TanStack Start" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
