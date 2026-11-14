import type { ComparePageView } from "../compare/types";
import type { Profile } from "../components/ValProvider";
import {
  bodyField,
  heroAltField,
  heroImageField,
  publishedField,
  sectionsField,
  titleField,
} from "../diff/fixtures";
import { lineDiff } from "../proposals/lineDiff";
import type {
  ReviewCode,
  ReviewCodeFile,
  ReviewPageModel,
  ReviewPane,
  ReviewSession,
} from "./types";

/*
 * One publish, told three ways: a proposal with content and code, the same
 * content on the site, and a proposal that changes only code.
 */

export const profiles: Record<string, Profile> = {
  "profile-fredrik": { fullName: "Fredrik Ekholdt", avatar: null },
  "profile-ada": { fullName: "Ada Lovelace", avatar: null },
  "profile-linus": { fullName: "Linus Berg", avatar: null },
};

export const pricingSession: ReviewSession = {
  id: "session-pricing",
  title: "Add a pricing page",
};
export const footerSession: ReviewSession = {
  id: "session-footer",
  title: "Fix footer spacing",
};

const helloId = "node:/blogs/hello";
const pricingId = "node:/pricing";
const aboutId = "node:/about";
const authorsId = "node:/content/authors.val.ts";

const helloPane: ReviewPane = {
  title: "Hello, spring",
  location: "/blogs/hello",
  change: "changed",
  pageUrl: "/blogs/hello",
  rows: [
    { ...titleField, authorIds: ["profile-fredrik"] },
    { ...publishedField, authorIds: ["profile-fredrik"] },
    {
      ...heroImageField,
      authorIds: ["profile-fredrik"],
      session: pricingSession,
    },
    {
      ...heroAltField,
      authorIds: ["profile-fredrik"],
      session: pricingSession,
    },
    { ...sectionsField, authorIds: ["profile-fredrik", "profile-ada"] },
    { ...bodyField, authorIds: ["profile-ada"] },
  ],
};

const pricingPane: ReviewPane = {
  title: "/pricing",
  change: "added",
  pageUrl: "/pricing",
  rows: [
    {
      id: "pricing-title",
      label: "title",
      value: { kind: "text", before: null, after: "Pricing" },
      authorIds: ["profile-fredrik"],
      session: pricingSession,
    },
    {
      id: "pricing-lead",
      label: "lead",
      value: {
        kind: "text",
        before: null,
        after: "Free for one editor. Every plan includes history and restore.",
      },
      authorIds: ["profile-fredrik"],
      session: pricingSession,
    },
    {
      id: "pricing-plans",
      label: "plans",
      value: {
        kind: "list",
        items: [
          { id: "plan-free", title: "Free", at: 1, was: null },
          { id: "plan-team", title: "Team", at: 2, was: null },
          { id: "plan-company", title: "Company", at: 3, was: null },
        ],
      },
      authorIds: ["profile-fredrik"],
      session: pricingSession,
    },
  ],
};

const aboutPane: ReviewPane = {
  title: "About us",
  location: "/about",
  change: "moved",
  renamedFrom: "/about-us",
  pageUrl: "/about",
  rows: [
    {
      id: "about-address",
      label: "address",
      value: { kind: "text", before: "/about-us", after: "/about" },
      authorIds: ["profile-linus"],
    },
  ],
};

const authorsPane: ReviewPane = {
  title: "Authors",
  location: "Content",
  change: "changed",
  rows: [
    {
      id: "authors-fredrik-bio",
      label: "fredrik › bio",
      value: {
        kind: "text",
        before: "Builds Val. Writes about content and code.",
        after: "Builds Val. Writes about content, code and the space between.",
      },
      authorIds: ["profile-ada"],
    },
  ],
};

const contentSections: ReviewPageModel["sections"] = [
  {
    id: "pages",
    title: "Pages",
    nodes: [
      {
        id: helloId,
        label: "/blogs/hello",
        kind: "page",
        change: "changed",
        changedCount: helloPane.rows.length,
      },
      {
        id: pricingId,
        label: "/pricing",
        kind: "page",
        change: "added",
        changedCount: pricingPane.rows.length,
      },
      {
        id: aboutId,
        label: "/about",
        kind: "page",
        change: "moved",
        renamedFrom: "/about-us",
        changedCount: aboutPane.rows.length,
      },
    ],
  },
  {
    id: "data",
    title: "Data",
    nodes: [
      {
        id: authorsId,
        label: "Authors",
        kind: "module",
        change: "changed",
        changedCount: authorsPane.rows.length,
      },
    ],
  },
];

const contentPanes: Record<string, ReviewPane> = {
  [helloId]: helloPane,
  [pricingId]: pricingPane,
  [aboutId]: aboutPane,
  [authorsId]: authorsPane,
};

const changeCount = Object.values(contentPanes).reduce(
  (sum, pane) => sum + pane.rows.length,
  0,
);

/* ------------------------------------------------------------------ code */

function file(
  path: string,
  before: string | null,
  after: string | null,
): ReviewCodeFile {
  // The product's own line diff, so the story shows what Review would.
  const lines = lineDiff(before, after);
  return {
    path,
    change: before === null ? "added" : after === null ? "deleted" : "modified",
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
    lines,
  };
}

const BUTTON_BEFORE = `import { cn } from "../cn";

export function Button({ children, onClick }: ButtonProps) {
  return (
    <button className="btn" onClick={onClick}>
      {children}
    </button>
  );
}
`;

const BUTTON_AFTER = `import { cn } from "../cn";

export function Button({ children, onClick, variant }: ButtonProps) {
  return (
    <button className={cn("btn", variant === "ghost" && "btn-ghost")} onClick={onClick}>
      {children}
    </button>
  );
}
`;

const PRICING_ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { useVal } from "../val/client";
import pricingVal from "./pricing.val";
import { Button } from "../components/Button";

export const Route = createFileRoute("/pricing")({ component: Pricing });

function Pricing() {
  const { title, lead, plans } = useVal(pricingVal);
  return (
    <main>
      <h1>{title}</h1>
      <p>{lead}</p>
      {plans.map((plan) => (
        <Button key={plan.name} variant="ghost">
          {plan.name}
        </Button>
      ))}
    </main>
  );
}
`;

const CSS_BEFORE = `.footer {
  display: grid;
  gap: 1rem;
  padding: 2rem 1rem;
}
`;

const CSS_AFTER = `.footer {
  display: grid;
  gap: 1.5rem;
  padding: 3rem 1rem 2rem;
  border-top: 1px solid var(--line);
}
`;

const PACKAGE_BEFORE = `{
  "dependencies": {
    "@valbuild/tanstack": "0.153.1"
  }
}
`;

const PACKAGE_AFTER = `{
  "dependencies": {
    "@valbuild/tanstack": "0.154.0"
  }
}
`;

export const code: ReviewCode = {
  build: "The preview is built from this code",
  groups: [
    {
      session: { ...pricingSession, by: "Fredrik", when: "12 November" },
      files: [
        file("src/components/Button.tsx", BUTTON_BEFORE, BUTTON_AFTER),
        file("src/routes/pricing.tsx", null, PRICING_ROUTE),
      ],
    },
    {
      session: { ...footerSession, by: "Ada", when: "13 November" },
      files: [file("src/styles/app.css", CSS_BEFORE, CSS_AFTER)],
    },
    {
      session: null,
      files: [file("package.json", PACKAGE_BEFORE, PACKAGE_AFTER)],
    },
  ],
};

/* ---------------------------------------------------------------- models */

const SITE = { label: "The site", caption: "What visitors see now" };

/** A proposal that changes content and code. */
export const proposalModel: ReviewPageModel = {
  left: SITE,
  right: { label: "This proposal", caption: "What publishing it makes live" },
  changeCount,
  sections: contentSections,
  panes: contentPanes,
  code,
  affected: {
    byContent: [{ url: "/authors/fredrik", because: "Authors" }],
    byCode: [
      { url: "/", because: "Button.tsx" },
      { url: "/contact", because: "Button.tsx" },
    ],
    everyPageBecause: "app.css",
  },
  profiles,
};

/** The same content changes on the site: no code, nothing to build. */
export const siteModel: ReviewPageModel = {
  left: { label: "Published", caption: "What is live now" },
  right: { label: "After publish", caption: `${changeCount} changes` },
  changeCount,
  sections: contentSections,
  panes: contentPanes,
  profiles,
};

/** A proposal with no content change at all: there is still code to review. */
export const codeOnlyModel: ReviewPageModel = {
  left: SITE,
  right: { label: "This proposal", caption: "What publishing it makes live" },
  changeCount: 0,
  sections: [],
  panes: {},
  code,
  affected: {
    byContent: [],
    byCode: [
      { url: "/", because: "Button.tsx" },
      { url: "/contact", because: "Button.tsx" },
      { url: "/pricing", because: "pricing.tsx" },
    ],
    everyPageBecause: "app.css",
  },
  profiles,
};

export const emptyModel: ReviewPageModel = {
  left: { label: "Published", caption: "What is live now" },
  right: { label: "After publish" },
  changeCount: 0,
  sections: [],
  panes: {},
  profiles,
};

/* ----------------------------------------------------------------- pages */

/**
 * A page, drawn: the stand-in for a frame of the site and of the proposal.
 * The right side differs from the left where the fixtures say it does.
 */
export function MockPage({ url, side, device }: ComparePageView) {
  const after = side === "right";
  return (
    <div
      className="flex h-fit w-full flex-col gap-3 rounded border border-gray-300 bg-white p-4 text-black shadow-sm"
      style={{ maxWidth: device === "mobile" ? 260 : 720 }}
    >
      <div className="truncate text-[10px] uppercase tracking-wider text-gray-500">
        {after ? "spring-campaign.valstart.dev" : "example.com"}
        {url}
      </div>
      <div
        className="flex h-28 items-center justify-center rounded text-xs text-gray-600"
        style={{ background: after ? "#99f6e4" : "#cbd5e1" }}
      >
        {after ? "office_b71c4.webp" : "team_3f9a1.webp"}
      </div>
      <div className="text-lg font-semibold leading-snug">
        {after
          ? "Content that ships with the code, and stays editable"
          : "Content that ships with your code"}
      </div>
      <div className="h-3 w-3/4 rounded bg-gray-200" />
      <div className="h-3 w-2/3 rounded bg-gray-200" />
      {after && (
        <div className="rounded border border-gray-300 p-2 text-xs">
          Pricing table
        </div>
      )}
      <div className="h-3 w-1/2 rounded bg-gray-200" />
      <div
        className="mt-2 w-fit rounded px-3 py-1 text-xs"
        style={
          after
            ? { border: "1px solid #111", color: "#111" }
            : { background: "#111", color: "#fff" }
        }
      >
        Get started
      </div>
    </div>
  );
}
