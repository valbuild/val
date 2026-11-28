/**
 * The code-mode catalogue: the changes the assistant's tools most often make
 * to a site's code, each written ONCE, as the tool calls a model makes for it
 * (no model is ever called), with what should follow. Every level's runner
 * reads this file and drives the product's own code with it:
 *
 * - `headless`: `scenarios/src/codeModeCatalogue.scenario.test.ts`. The
 *   tools as `useAI` runs them, Val's real server, the Studio's stores; a
 *   Build lands and the Studio does not reload.
 * - `build`: `packages/cli/src/publish/codeModeCatalogue.test.ts`. The site
 *   published by `val publish`, the change built by the Studio's own
 *   `buildQuickPreview` and `runStudioDeploy` with the real builder: what
 *   the page would be given -- its code and its CSS.
 * - `browser`: `e2e/proposal/codeModeCatalogue.spec.ts`. A real Studio and
 *   page: the canvas, the quick preview, the page log, the checks bar.
 * - `platform`: valbuild/home's `platform/scripts/loop.ts`, the one place a
 *   real build is drawn by a real browser on the real platform.
 *
 * A case with `knownBug` runs as `test.failing` (jest) / `test.fail`
 * (Playwright) at the levels the bug is seen at, so it turns red when fixed:
 * take the bug off then. See `docs/handoff/code-mode-test-rig-plan.md`.
 *
 * The site is `codeModeSite.ts`'s `styledSiteCode` (a hero, a button, the
 * index route, a root route linking a Tailwind stylesheet), plus what a
 * case's `site` adds.
 */
import {
  BUTTON_FILE,
  HERO_FILE,
  ROOT_ROUTE_FILE,
  ROUTE_FILE,
  STYLESHEET_FILE,
  bareImportRootRoute,
  button,
  darkHero,
  heroSection,
  indexRoute,
  styledSiteCode,
} from "./codeModeSite";

/** One tool call of a scripted turn, as the assistant sends it. */
export type ToolStep = { name: string; arguments: Record<string, unknown> };

export type CaseLevel = "headless" | "build" | "browser" | "platform";

/**
 * What the quick preview of the change should come to.
 *
 * - `shown`: the page in the preview shows the change.
 * - `blocked`: a quick preview cannot show it (`why`), and the product -- not
 *   the model -- has to say so (G2 in the plan).
 * - `fails`: the change does not bundle; the preview fails and says why.
 */
export type PreviewOutcome =
  | { kind: "shown" }
  | {
      kind: "blocked";
      why: "new-route" | "dependency" | "schema" | "module" | "server-code";
    }
  | { kind: "fails"; why: "bundle" };

export type CodeModeCase = {
  id: string;
  title: string;
  /** Files the site has before the change, over `styledSiteCode`. */
  site?: Record<string, string>;
  /** The turns, in order, each the tool calls of one scripted turn. */
  turns: ToolStep[][];
  expect: {
    /** Tool calls that should answer `isError`, by turn and index. Else all succeed. */
    toolErrors?: Array<[turn: number, call: number]>;
    /** The staged files after the turns: text, or `null` for a deleted file. */
    staged: Record<string, string | null>;
    preview: PreviewOutcome;
    /**
     * On the page once the change is shown: text that has to be there, and
     * CSS the page's stylesheet has to have (as it appears in the CSS:
     * escaped selectors, `#rrggbb` colours).
     */
    onPage?: { text?: string[]; css?: string[] };
    /** `ok`, or the number of problems the check reports. */
    typecheck?: "ok" | { errors: number };
    lint?: "ok" | { problems: number };
    /** After Build: served without a reload, or the build fails. */
    build: "no-reload" | "fails";
  };
  /** The levels this case runs at. */
  levels: CaseLevel[];
  /** The bug that keeps this case red, and the levels it is seen at. */
  knownBug?: { what: string; levels: CaseLevel[] };
};

/** `edit_file`, as the assistant sends it. */
export function edit(
  path: string,
  oldString: string,
  newString: string,
): ToolStep {
  return {
    name: "edit_file",
    arguments: {
      path,
      old_string: oldString,
      new_string: newString,
      message: `Change ${path}`,
    },
  };
}

/** `write_files`, as the assistant sends it: `null` deletes a file. */
export function write(files: Record<string, string | null>): ToolStep {
  return { name: "write_files", arguments: { files, message: "Change files" } };
}

/** A file as one edit leaves it: the edit applied, once, or a thrown error. */
export function edited(text: string, oldString: string, newString: string) {
  const at = text.indexOf(oldString);
  if (at === -1 || text.indexOf(oldString, at + 1) !== -1) {
    throw new Error(`'${oldString}' is not in the file exactly once`);
  }
  return text.slice(0, at) + newString + text.slice(at + oldString.length);
}

const heroSectionTag = `    <section className="bg-white text-black py-24">`;
const secondaryButton = `      className={variant === "primary" ? "bg-black text-white" : "border"}`;
const heroTitle = `      <h1 className="text-5xl font-bold">{title}</h1>`;
const heroButtons = `      <div className="mt-8 flex gap-4">`;
const heroImport = `import { Button } from "../Button";`;

const ABOUT_ROUTE = "src/routes/about.tsx";
const BADGE_FILE = "src/components/Badge.tsx";
const LOGO_FILE = "src/components/logo.svg";
const THEME_FILE = "src/theme.css";
const TSCONFIG = "tsconfig.json";

const badge = `export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-emerald-600 px-3 text-white">{children}</span>;
}
`;

/** A theme the stylesheet imports, as the templates' `theme/theme.css` is. */
const theme = `@theme {\n  --color-brand: #123456;\n}\n`;
const themedStylesheet = `@import "tailwindcss";\n@import "./theme.css";\n`;

const tsconfig = `{
  "compilerOptions": {
    "jsx": "react-jsx",
    "strict": true,
    "baseUrl": ".",
    "paths": { "~/*": ["./src/*"] }
  }
}
`;

const k1Hero = edited(heroSection, darkHero.old_string, darkHero.new_string);
const k2Button = edited(
  button,
  secondaryButton,
  `      className={variant === "primary" ? "bg-black text-white" : "border-2! border-red-500!"}`,
);
const k3Hero = edited(
  heroSection,
  heroTitle,
  `      <h1 className="text-5xl font-bold" style={{ letterSpacing: "0.2em" }}>{title}</h1>`,
);
const k5Route = edited(
  indexRoute,
  `        title="Dette er så gøy"`,
  `        title="Dette er enda gøyere"`,
);
const k6Hero = edited(
  heroSection,
  heroTitle,
  `      <header data-k6="">\n        <h1 className="text-5xl font-bold">{title}</h1>\n        {intro.length > 0 && <small>Les mer</small>}\n      </header>`,
);
const k7Hero = edited(
  edited(
    heroSection,
    heroImport,
    `${heroImport}\nimport { Badge } from "../Badge";`,
  ),
  heroButtons,
  `      <Badge>Ny</Badge>\n${heroButtons}`,
);
const k8Route = `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: () => <main><h1>Om oss</h1></main>,
});
`;
const k8Index = edited(
  indexRoute,
  `    </main>`,
  `      <a href="/about">Om oss</a>\n    </main>`,
);
const k9Hero = edited(
  edited(heroSection, `${heroImport}\n`, ""),
  `      <div className="mt-8 flex gap-4">
        <Button href="/kontakt">Kontakt oss</Button>
        <Button href="/tjenester" variant="secondary">
          Våre tjenester
        </Button>
      </div>
`,
  "",
);
const k10Hero = edited(
  heroSection,
  heroImport,
  `import { Button } from "../ActionButton";`,
);
const k11Package = edited(
  styledSiteCode["package.json"] ?? "",
  `    "react": "^19.2.8"`,
  `    "react": "^19.2.8",\n    "date-fns": "^4.1.0"`,
);
const k11Hero = edited(
  edited(
    heroSection,
    heroImport,
    `${heroImport}\nimport { format } from "date-fns";`,
  ),
  heroButtons,
  `      <time>{format(new Date(0), "yyyy")}</time>\n${heroButtons}`,
);
const k14Hero = edited(
  heroSection,
  heroTitle,
  `      <h1 className="text-5xl font-bold">{title.toFixed(2)}</h1>`,
);
const k15Hero = edited(
  heroSection,
  heroImport,
  `${heroImport}\nimport { useState } from "react";`,
);
const k16Hero = edited(heroSection, heroTitle, `      <h1 className="text-5xl`);
const k17Hero = edited(
  heroSection,
  heroSectionTag,
  `    <section className="bg-slate-900 text-white py-24">`,
);
const k17Button = edited(
  button,
  secondaryButton,
  `      className={variant === "primary" ? "bg-white text-black" : "border"}`,
);
const k17Route = edited(
  indexRoute,
  `        intro="Vi lager nettsider som er enkle å endre."`,
  `        intro="Vi lager nettsider som alle kan endre."`,
);
const k22Theme = edited(theme, `#123456`, `#654321`);
const k22Hero = edited(
  heroSection,
  heroSectionTag,
  `    <section className="bg-brand text-black py-24">`,
);
const k23Hero = edited(
  edited(
    heroSection,
    heroImport,
    `${heroImport}\nimport logo from "../logo.svg";`,
  ),
  heroButtons,
  `      <img src={logo} alt="" data-k23="" />\n${heroButtons}`,
);
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n`;
const k24Hero = edited(
  edited(
    heroSection,
    heroImport,
    `${heroImport}\nimport { Badge } from "~/components/Badge";`,
  ),
  heroButtons,
  `      <Badge>Alias</Badge>\n${heroButtons}`,
);
const k25Root = edited(
  styledSiteCode[ROOT_ROUTE_FILE] ?? "",
  `  head: () => ({ links: [{ rel: "stylesheet", href: appCss }] }),`,
  `  head: () => ({\n    meta: [{ name: "description", content: "Nettsider som er enkle å endre" }],\n    links: [{ rel: "stylesheet", href: appCss }],\n  }),`,
);

/** A class the live site has no rule for, as Tailwind writes the rule's selector. */
const TAILWIND_CSS_BUG = {
  what: "a class the change adds has no style: the stored source has no stylesheet, so the build ships the live one (see packages/cli/src/publish/studioStyles.test.ts)",
  levels: ["build", "browser", "platform"],
} satisfies CodeModeCase["knownBug"];

export const CASES: CodeModeCase[] = [
  {
    id: "K1",
    title: "change an existing Tailwind class",
    turns: [[edit(HERO_FILE, darkHero.old_string, darkHero.new_string)]],
    expect: {
      staged: { [HERO_FILE]: k1Hero },
      preview: { kind: "shown" },
      onPage: { css: [".bg-black"] },
      typecheck: "ok",
      lint: "ok",
      build: "no-reload",
    },
    levels: ["headless", "build", "browser", "platform"],
  },
  {
    id: "K2",
    title: "add a Tailwind class new to the site, important",
    turns: [
      [
        edit(
          BUTTON_FILE,
          secondaryButton,
          `      className={variant === "primary" ? "bg-black text-white" : "border-2! border-red-500!"}`,
        ),
      ],
    ],
    expect: {
      staged: { [BUTTON_FILE]: k2Button },
      preview: { kind: "shown" },
      onPage: { css: [".border-red-500\\!"] },
      typecheck: "ok",
      lint: "ok",
      build: "no-reload",
    },
    levels: ["headless", "build", "browser", "platform"],
    knownBug: TAILWIND_CSS_BUG,
  },
  {
    id: "K3",
    title: "add an inline style",
    turns: [
      [
        edit(
          HERO_FILE,
          heroTitle,
          `      <h1 className="text-5xl font-bold" style={{ letterSpacing: "0.2em" }}>{title}</h1>`,
        ),
      ],
    ],
    expect: {
      staged: { [HERO_FILE]: k3Hero },
      preview: { kind: "shown" },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
  },
  {
    id: "K4",
    title: "edit the site's stylesheet",
    turns: [
      [
        edit(
          STYLESHEET_FILE,
          `@import "tailwindcss";\n`,
          `@import "tailwindcss";\n\nh1 { color: #0a0b0c; }\n`,
        ),
      ],
    ],
    expect: {
      staged: {
        [STYLESHEET_FILE]: `@import "tailwindcss";\n\nh1 { color: #0a0b0c; }\n`,
      },
      preview: { kind: "shown" },
      onPage: { css: ["#0a0b0c"] },
      build: "no-reload",
    },
    // Not the Tailwind bug: the stylesheet is among the proposal's files, so
    // the tab has it and compiles it.
    levels: ["headless", "build", "browser", "platform"],
  },
  {
    id: "K5",
    title: "change text",
    turns: [
      [
        edit(
          ROUTE_FILE,
          `        title="Dette er så gøy"`,
          `        title="Dette er enda gøyere"`,
        ),
      ],
    ],
    expect: {
      staged: { [ROUTE_FILE]: k5Route },
      preview: { kind: "shown" },
      onPage: { text: ["Dette er enda gøyere"] },
      typecheck: "ok",
      lint: "ok",
      build: "no-reload",
    },
    levels: ["headless", "build", "browser", "platform"],
  },
  {
    id: "K6",
    title: "change markup: wrap in an element, add a conditional",
    turns: [
      [
        edit(
          HERO_FILE,
          heroTitle,
          `      <header data-k6="">\n        <h1 className="text-5xl font-bold">{title}</h1>\n        {intro.length > 0 && <small>Les mer</small>}\n      </header>`,
        ),
      ],
    ],
    expect: {
      staged: { [HERO_FILE]: k6Hero },
      preview: { kind: "shown" },
      onPage: { text: ["Les mer"] },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
  },
  {
    id: "K7",
    title: "a new component, imported by an existing one",
    turns: [
      [
        write({ [BADGE_FILE]: badge }),
        edit(
          HERO_FILE,
          heroImport,
          `${heroImport}\nimport { Badge } from "../Badge";`,
        ),
        edit(HERO_FILE, heroButtons, `      <Badge>Ny</Badge>\n${heroButtons}`),
      ],
    ],
    expect: {
      staged: { [BADGE_FILE]: badge, [HERO_FILE]: k7Hero },
      preview: { kind: "shown" },
      onPage: { text: ["Ny"], css: [".bg-emerald-600"] },
      typecheck: "ok",
      lint: "ok",
      build: "no-reload",
    },
    levels: ["headless", "build", "browser", "platform"],
    knownBug: TAILWIND_CSS_BUG,
  },
  {
    id: "K8",
    title: "a new route, and a link to it",
    turns: [
      [
        write({ [ABOUT_ROUTE]: k8Route }),
        edit(
          ROUTE_FILE,
          `    </main>`,
          `      <a href="/about">Om oss</a>\n    </main>`,
        ),
      ],
    ],
    expect: {
      staged: { [ABOUT_ROUTE]: k8Route, [ROUTE_FILE]: k8Index },
      preview: { kind: "blocked", why: "new-route" },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
  },
  {
    id: "K9",
    title: "delete a component and its import",
    turns: [
      [
        write({ [BUTTON_FILE]: null }),
        edit(HERO_FILE, `${heroImport}\n`, ""),
        edit(
          HERO_FILE,
          `      <div className="mt-8 flex gap-4">
        <Button href="/kontakt">Kontakt oss</Button>
        <Button href="/tjenester" variant="secondary">
          Våre tjenester
        </Button>
      </div>
`,
          "",
        ),
      ],
    ],
    expect: {
      staged: { [BUTTON_FILE]: null, [HERO_FILE]: k9Hero },
      preview: { kind: "shown" },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
  },
  {
    id: "K10",
    title: "rename a file and update its importer, in one call",
    turns: [
      [
        write({
          [BUTTON_FILE]: null,
          "src/components/ActionButton.tsx": button,
          [HERO_FILE]: k10Hero,
        }),
      ],
    ],
    expect: {
      staged: {
        [BUTTON_FILE]: null,
        "src/components/ActionButton.tsx": button,
        [HERO_FILE]: k10Hero,
      },
      preview: { kind: "shown" },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
  },
  {
    id: "K11",
    title: "import a new dependency, with package.json changed",
    turns: [[write({ "package.json": k11Package, [HERO_FILE]: k11Hero })]],
    expect: {
      staged: { "package.json": k11Package, [HERO_FILE]: k11Hero },
      preview: { kind: "blocked", why: "dependency" },
      build: "no-reload",
    },
    levels: ["headless", "browser"],
  },
  {
    id: "K14",
    title: "a type error",
    turns: [
      [
        edit(
          HERO_FILE,
          heroTitle,
          `      <h1 className="text-5xl font-bold">{title.toFixed(2)}</h1>`,
        ),
      ],
    ],
    expect: {
      staged: { [HERO_FILE]: k14Hero },
      preview: { kind: "shown" },
      typecheck: { errors: 1 },
      build: "no-reload",
    },
    levels: ["headless", "browser"],
  },
  {
    id: "K15",
    title: "a lint problem",
    turns: [
      [
        edit(
          HERO_FILE,
          heroImport,
          `${heroImport}\nimport { useState } from "react";`,
        ),
      ],
    ],
    expect: {
      staged: { [HERO_FILE]: k15Hero },
      preview: { kind: "shown" },
      lint: { problems: 1 },
      build: "no-reload",
    },
    levels: ["headless", "browser"],
  },
  {
    id: "K16",
    title: "code that does not bundle",
    turns: [[edit(HERO_FILE, heroTitle, `      <h1 className="text-5xl`)]],
    expect: {
      staged: { [HERO_FILE]: k16Hero },
      preview: { kind: "fails", why: "bundle" },
      build: "fails",
    },
    levels: ["headless", "build", "browser", "platform"],
  },
  {
    id: "K17",
    title: "several edits across three files in one turn",
    turns: [
      [
        edit(
          HERO_FILE,
          heroSectionTag,
          `    <section className="bg-slate-900 text-white py-24">`,
        ),
        edit(
          BUTTON_FILE,
          secondaryButton,
          `      className={variant === "primary" ? "bg-white text-black" : "border"}`,
        ),
        edit(
          ROUTE_FILE,
          `        intro="Vi lager nettsider som er enkle å endre."`,
          `        intro="Vi lager nettsider som alle kan endre."`,
        ),
      ],
    ],
    expect: {
      staged: {
        [HERO_FILE]: k17Hero,
        [BUTTON_FILE]: k17Button,
        [ROUTE_FILE]: k17Route,
      },
      preview: { kind: "shown" },
      onPage: {
        text: ["Vi lager nettsider som alle kan endre."],
        css: [".bg-slate-900"],
      },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
    knownBug: TAILWIND_CSS_BUG,
  },
  {
    id: "K21",
    title: "a change to a site that imports its stylesheet for its effect",
    site: { [ROOT_ROUTE_FILE]: bareImportRootRoute },
    turns: [[edit(HERO_FILE, darkHero.old_string, darkHero.new_string)]],
    expect: {
      staged: { [HERO_FILE]: k1Hero },
      preview: { kind: "shown" },
      onPage: { css: [".bg-black"] },
      build: "no-reload",
    },
    levels: ["build", "platform"],
    knownBug: {
      what: 'the stored source has no stylesheet, so `import "../styles.css"` does not resolve and the build fails',
      levels: ["build", "platform"],
    },
  },
  {
    id: "K22",
    title: "change a theme token the stylesheet imports",
    site: { [STYLESHEET_FILE]: themedStylesheet, [THEME_FILE]: theme },
    turns: [
      [
        edit(THEME_FILE, `#123456`, `#654321`),
        edit(
          HERO_FILE,
          heroSectionTag,
          `    <section className="bg-brand text-black py-24">`,
        ),
      ],
    ],
    expect: {
      staged: { [THEME_FILE]: k22Theme, [HERO_FILE]: k22Hero },
      preview: { kind: "shown" },
      onPage: { css: ["#654321", ".bg-brand"] },
      build: "no-reload",
    },
    levels: ["headless", "build", "platform"],
    knownBug: TAILWIND_CSS_BUG,
  },
  {
    id: "K23",
    title: "import a new image from a component",
    turns: [[write({ [LOGO_FILE]: logoSvg }), write({ [HERO_FILE]: k23Hero })]],
    expect: {
      staged: { [LOGO_FILE]: logoSvg, [HERO_FILE]: k23Hero },
      preview: { kind: "shown" },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
    knownBug: {
      what: "an image the tools write is built as code: `logo.svg` goes to the builder as a source file, and fails to parse (`Unexpected JSX expression`), where `val publish` would take it as an asset",
      levels: ["build", "browser"],
    },
  },
  {
    id: "K24",
    title: "import through a tsconfig path alias",
    site: { [TSCONFIG]: tsconfig, [BADGE_FILE]: badge },
    turns: [[write({ [HERO_FILE]: k24Hero })]],
    expect: {
      staged: { [HERO_FILE]: k24Hero },
      preview: { kind: "shown" },
      onPage: { text: ["Alias"] },
      build: "no-reload",
    },
    levels: ["headless", "build", "browser"],
  },
  {
    id: "K25",
    title: "change the head of a layout",
    turns: [[write({ [ROOT_ROUTE_FILE]: k25Root })]],
    expect: {
      staged: { [ROOT_ROUTE_FILE]: k25Root },
      preview: { kind: "shown" },
      build: "no-reload",
    },
    levels: ["headless", "build"],
  },
];

/** The site a case starts from. */
export function siteOf(c: CodeModeCase): Record<string, string> {
  return { ...styledSiteCode, ...c.site };
}

/** The cases that run at a level. */
export function casesAt(level: CaseLevel): CodeModeCase[] {
  return CASES.filter((c) => c.levels.includes(level));
}

/** Whether a case is known to fail at a level. */
export function knownToFailAt(c: CodeModeCase, level: CaseLevel): boolean {
  return c.knownBug?.levels.includes(level) ?? false;
}
