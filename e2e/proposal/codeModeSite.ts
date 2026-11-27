/**
 * A small site's code, as code mode's tools see it: the project's live
 * source (`GET /v1/project-source`), which `search_code`, `read_file` and
 * `edit_file` read through the tab's snapshot of the project.
 *
 * Shaped like the sites the reports came from (a TanStack Start template
 * with section components): a hero section rendered by the home route.
 * Shared by the browser tests (`codeModeTasks.spec.ts`, which hands it to
 * the mock content host) and the headless ones
 * (`scenarios/src/codeModeTasks.scenario.test.ts`, which hands it to the
 * world as source text), so both do the same tasks on the same files.
 *
 * Only code: the content modules are each test's own, since a `.val.ts`
 * has to be a module the app or the world actually runs.
 */

export const HERO_FILE = "src/components/sections/HeroSection.tsx";
export const ROUTE_FILE = "src/routes/index.tsx";
export const BUTTON_FILE = "src/components/Button.tsx";

export const heroSection = `import { Button } from "../Button";

type Props = {
  eyebrow?: string;
  title: string;
  intro: string;
};

export default function HeroSection({ eyebrow, title, intro }: Props) {
  return (
    <section className="bg-white text-black py-24">
      {eyebrow && <p className="uppercase tracking-wide">{eyebrow}</p>}
      <h1 className="text-5xl font-bold">{title}</h1>
      <p className="mt-4 text-lg">{intro}</p>
      <div className="mt-8 flex gap-4">
        <Button href="/kontakt">Kontakt oss</Button>
        <Button href="/tjenester" variant="secondary">
          Våre tjenester
        </Button>
      </div>
    </section>
  );
}
`;

export const button = `type Props = {
  href: string;
  variant?: "primary" | "secondary";
  children: React.ReactNode;
};

export function Button({ href, variant = "primary", children }: Props) {
  return (
    <a
      href={href}
      className={variant === "primary" ? "bg-black text-white" : "border"}
    >
      {children}
    </a>
  );
}
`;

export const indexRoute = `import { createFileRoute } from "@tanstack/react-router";
import HeroSection from "../components/sections/HeroSection";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main>
      <HeroSection
        title="Dette er så gøy"
        intro="Vi lager nettsider som er enkle å endre."
      />
    </main>
  );
}
`;

export const packageJson = `{
  "name": "code-mode-site",
  "private": true,
  "type": "module",
  "dependencies": {
    "@tanstack/react-router": "^1.168.0",
    "@valbuild/tanstack": "^0.155.0",
    "react": "^19.2.8"
  }
}
`;

/** The site's code, by project path. */
export const siteCode: Record<string, string> = {
  [HERO_FILE]: heroSection,
  [BUTTON_FILE]: button,
  [ROUTE_FILE]: indexRoute,
  "package.json": packageJson,
};

/**
 * "Make the hero dark": what an assistant changes, as `edit_file` sends it --
 * the line `read_file` gave, and its replacement.
 */
export const darkHero = {
  old_string: `    <section className="bg-white text-black py-24">`,
  new_string: `    <section className="bg-black text-white py-24">`,
};

export const STYLESHEET_FILE = "src/styles.css";
export const ROOT_ROUTE_FILE = "src/routes/__root.tsx";
export const ROUTER_FILE = "src/router.tsx";

/** As the templates write theirs: Tailwind v4, with nothing it cannot compile. */
export const stylesheet = `@import "tailwindcss";\n`;

/**
 * The root route, linking the stylesheet as the templates do: `?url`, and a
 * `<link>` in the head (`_site.tsx` in valbuild/templates).
 */
export const rootRoute = `import { Outlet, createRootRoute } from "@tanstack/react-router";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({ links: [{ rel: "stylesheet", href: appCss }] }),
  component: () => <Outlet />,
});
`;

/**
 * The root route of a site that imports its stylesheet for its effect, as
 * Vite lets it: the other way a TanStack site is written.
 */
export const bareImportRootRoute = `import { Outlet, createRootRoute } from "@tanstack/react-router";
import "../styles.css";

export const Route = createRootRoute({ component: () => <Outlet /> });
`;

export const router = `import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({ routeTree });
}
`;

/**
 * The same site, styled: a root route that imports a Tailwind stylesheet.
 * What a check of a change's STYLES is made on, since a class only has a
 * style when the site's stylesheet is compiled with it.
 */
export const styledSiteCode: Record<string, string> = {
  ...siteCode,
  [STYLESHEET_FILE]: stylesheet,
  [ROOT_ROUTE_FILE]: rootRoute,
  [ROUTER_FILE]: router,
};

/**
 * A Tailwind class nothing in the site uses, so the live stylesheet has no
 * rule for it: a change that adds it is only styled where the stylesheet was
 * compiled again, from the changed code. `darkHero` cannot show that --
 * `bg-black` and `text-white` are the primary button's already.
 */
export const NEW_CLASS = "border-red-600";

/** "Give the secondary button a red border": report 4's change, as `edit_file` sends it. */
export const redBorderButton = {
  old_string: `      className={variant === "primary" ? "bg-black text-white" : "border"}`,
  new_string: `      className={variant === "primary" ? "bg-black text-white" : "border ${NEW_CLASS}"}`,
};

/**
 * Whether a stylesheet has a rule for a class: what a page needs to show it.
 * For plain class names only (letters, digits, `-`), which need no escaping
 * in a selector; anything else is refused rather than half-matched.
 */
export function hasRuleFor(css: string, className: string): boolean {
  if (!/^[A-Za-z0-9-]+$/.test(className)) {
    throw new Error(`hasRuleFor takes a plain class name, not '${className}'`);
  }
  return new RegExp(`\\.${className}\\s*[{,:]`).test(css);
}
