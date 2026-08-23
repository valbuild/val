#!/usr/bin/env node
/**
 * Generates `content/handbook.val.ts` — the example app's stand-in for a large
 * real handbook.
 *
 *   pnpm handbook generate [chapters] [sections]   default 24 x 10
 *   pnpm handbook status
 *
 * ## Why this fixture exists
 *
 * The store benchmark (`packages/ui/spa/bench/`) needs a project shaped like the
 * one that actually hurts, and `architecture.md` names it repeatedly: `select` at
 * TWO nested array levels, so an unscoped render of one visible section walks
 * every chapter and every section. Before this, the benchmark modelled that shape
 * synthetically, which left "measured against a synthetic project, not a real
 * one" as the last standing caveat on the go/no-go decision.
 *
 * This is that shape, in a real Val module in a real app that really builds and
 * really validates: nested lists with a `select` at each level, richtext bodies,
 * images, routes and `keyOf` references pointing outward — so the reference scan,
 * the render scope and the validation walk all have genuine work to do.
 *
 * Generated rather than hand-written, following the precedent of
 * `jsonvalues-fixtures.mjs`, so the size is a parameter and nobody is tempted to
 * hand-edit 3000 lines. Dependency-free on purpose: it runs with plain node.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const MODULE = path.join(appDir, "content", "handbook.val.ts");

const DEFAULT_CHAPTERS = 24;
const DEFAULT_SECTIONS = 10;

/**
 * Deterministic pseudo-random, seeded per call site.
 *
 * `Math.random()` would make every regeneration a diff of the whole file, which
 * turns a fixture refresh into an unreviewable commit.
 */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const TOPICS = [
  "Onboarding",
  "Working hours",
  "Expenses",
  "Travel",
  "Equipment",
  "Security",
  "Code review",
  "On-call",
  "Incident response",
  "Hiring",
  "Performance reviews",
  "Parental leave",
  "Remote work",
  "Office access",
  "Data handling",
  "Procurement",
  "Contracts",
  "Invoicing",
  "Time tracking",
  "Holidays",
  "Sick leave",
  "Pensions",
  "Insurance",
  "Offboarding",
  "Accessibility",
  "Brand",
  "Legal basics",
  "Sub-processors",
];

const SECTION_TITLES = [
  "What this covers",
  "Who to ask",
  "Before you start",
  "Step by step",
  "Approvals",
  "Deadlines",
  "Common mistakes",
  "Exceptions",
  "What it costs",
  "Where to find the form",
  "After you submit",
  "If something goes wrong",
];

const SENTENCES = [
  "This applies to everyone on a permanent contract, and to consultants where the engagement says so.",
  "Ask your team lead first; they can approve most of this without escalating.",
  "Keep the receipt — reimbursement needs the original, not a photo of a copy.",
  "The deadline is the last working day of the month, not the last day.",
  "If the amount is above the threshold, two approvals are required rather than one.",
  "Anything involving personal data goes past the data protection contact before it starts.",
  "There is a template for this; using it saves a round of comments.",
  "Exceptions exist and are fine, but they have to be written down somewhere findable.",
  "When in doubt, write it down and ask. A short note now is cheaper than a reconstruction later.",
  "This changed in the last revision, so an older printout may say something different.",
];

function paragraphs(random, count) {
  const blocks = [];
  for (let index = 0; index < count; index++) {
    const sentenceCount = 2 + Math.floor(random() * 3);
    const children = [];
    for (let s = 0; s < sentenceCount; s++) {
      const sentence = SENTENCES[Math.floor(random() * SENTENCES.length)];
      if (s === 1 && random() > 0.6) {
        // Some inline styling, so the richtext is not uniformly flat — the
        // serializer and the validation walk both have more to do.
        children.push({ tag: "span", styles: ["bold"], children: [sentence] });
        children.push(" ");
      } else {
        children.push(sentence + " ");
      }
    }
    blocks.push({ tag: "p", children });
  }
  if (random() > 0.5) {
    blocks.push({
      tag: "ul",
      children: [
        { tag: "li", children: [{ tag: "p", children: ["Check the date."] }] },
        {
          tag: "li",
          children: [{ tag: "p", children: ["Check who signed it."] }],
        },
      ],
    });
  }
  return blocks;
}

function literal(value, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = value
      .map((item) => pad + "  " + literal(item, indent + 2))
      .join(",\n");
    return "[\n" + inner + ",\n" + pad + "]";
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const inner = keys
      .map(
        (key) =>
          pad +
          "  " +
          JSON.stringify(key) +
          ": " +
          literal(value[key], indent + 2),
      )
      .join(",\n");
    return "{\n" + inner + ",\n" + pad + "}";
  }
  return JSON.stringify(value);
}

function generate(chapterCount, sectionCount) {
  const random = seeded(20260823);
  const chapters = [];
  for (let c = 0; c < chapterCount; c++) {
    const topic = TOPICS[c % TOPICS.length];
    const suffix =
      c >= TOPICS.length ? ` (part ${Math.floor(c / TOPICS.length) + 1})` : "";
    const sections = [];
    for (let s = 0; s < sectionCount; s++) {
      sections.push({
        heading: `${SECTION_TITLES[s % SECTION_TITLES.length]}`,
        // A richtext SOURCE is a plain array of blocks — no `_type` wrapper.
        // The wrapper is what an earlier version of this generator emitted, and
        // the CLI caught it: 240 sections, 240 "Expected 'array', got 'object'".
        body: paragraphs(random, 1 + Math.floor(random() * 3)),
        // Every third section points at a route, so the route reference scan and
        // the route over-approximation both have something to find.
        seeAlso: random() > 0.66 ? "/support/faq" : null,
      });
    }
    chapters.push({
      title: topic + suffix,
      slug:
        topic.toLowerCase().replace(/[^a-z]+/g, "-") + (suffix ? `-${c}` : ""),
      summary: SENTENCES[Math.floor(random() * SENTENCES.length)],
      // Every chapter names an owner, so `keyOf` references point outward at a
      // real module — which is what makes a rename guard have work to do.
      owner: c % 2 === 0 ? "freekh" : "kimmid",
      sections,
    });
  }
  return chapters;
}

function render(chapters, chapterCount, sectionCount) {
  return `import { s, c, type t } from "../val.config";
import authorsVal from "./authors.val";

// GENERATED by scripts/handbook-fixture.mjs — do not hand-edit.
// Regenerate with a different size: pnpm handbook generate ${chapterCount} ${sectionCount}

/**
 * A handbook: chapters of sections, with a \`select\` at BOTH array levels.
 *
 * This is the shape the store benchmark exists to measure. Two nested \`.render()\`
 * calls mean an UNSCOPED render of one visible section has to walk every chapter
 * and every section and run the user's \`select\` closure for each — which is
 * exactly the worst case \`packages/ui/spa/stores/architecture.md\` names, and the
 * reason \`RenderScope\` was added to \`packages/core\`.
 *
 * The rest of the shape is here so the other walks have real work too:
 * \`s.richtext()\` bodies for the validation walk, \`s.keyOf(authorsVal)\` and
 * \`s.route()\` for the reference scan, and an image per chapter for the file
 * reference scan.
 */
export const handbookSectionSchema = s.object({
  heading: s.string().minLength(2),
  body: s.richtext({
    style: { bold: true, italic: true },
    block: { h2: true, ul: true },
    inline: { a: true },
  }),
  /** A route this section points at, so route references have something to find. */
  seeAlso: s.route().nullable(),
});

export const handbookChapterSchema = s.object({
  title: s.string().minLength(2),
  slug: s.string().regexp(/^[a-z0-9-]+$/),
  summary: s.string().render({ as: "textarea" }),
  owner: s.keyOf(authorsVal),
  sections: s.array(handbookSectionSchema).render({
    as: "list",
    select: ({ val }) => ({
      title: val.heading,
      // Deliberately reads INTO the richtext: a \`select\` that only returned a
      // string would be cheap in a way a real one is not.
      subtitle: firstText(val.body) ?? null,
    }),
  }),
});

export type HandbookChapter = t.inferSchema<typeof handbookChapterSchema>;

/** The first bit of plain text in a richtext value, for a list subtitle. */
function firstText(body: unknown): string | null {
  if (!Array.isArray(body)) return null;
  for (const block of body) {
    if (block !== null && typeof block === "object") {
      const inner = (block as { children?: unknown }).children;
      if (Array.isArray(inner)) {
        for (const leaf of inner) {
          if (typeof leaf === "string" && leaf.trim().length > 0) {
            return leaf.trim().slice(0, 120);
          }
        }
      }
    }
  }
  return null;
}

export default c.define(
  "/content/handbook.val.ts",
  s.array(handbookChapterSchema).render({
    as: "list",
    select: ({ val }) => ({
      title: val.title,
      subtitle: \`\${val.sections.length} sections\`,
    }),
  }),
  ${literal(chapters, 2)},
);
`;
}

const command = process.argv[2] ?? "status";
if (command === "status") {
  if (!fs.existsSync(MODULE)) {
    console.log("handbook.val.ts: not generated");
  } else {
    const text = fs.readFileSync(MODULE, "utf8");
    const chapters = (text.match(/"sections":/g) ?? []).length;
    const sections = (text.match(/"heading":/g) ?? []).length;
    console.log(
      `handbook.val.ts: ${chapters} chapters, ${sections} sections, ` +
        `${(text.length / 1024).toFixed(0)} KB`,
    );
  }
} else if (command === "generate") {
  const chapters = Number(process.argv[3] ?? DEFAULT_CHAPTERS);
  const sections = Number(process.argv[4] ?? DEFAULT_SECTIONS);
  if (!Number.isInteger(chapters) || !Number.isInteger(sections)) {
    console.error("usage: pnpm handbook generate [chapters] [sections]");
    process.exit(1);
  }
  const raw = render(generate(chapters, sections), chapters, sections);
  // Formatted with the repo's prettier, not just emitted: `prettier --check .`
  // walks the whole tree in CI, so an unformatted 344 KB generated file fails the
  // build. Formatting here keeps regeneration idempotent — generate, check, and
  // the file is already what prettier wants.
  const config = await prettier.resolveConfig(MODULE);
  const text = await prettier.format(raw, {
    ...config,
    filepath: MODULE,
    parser: "typescript",
  });
  fs.writeFileSync(MODULE, text);
  console.log(
    `wrote ${path.relative(appDir, MODULE)}: ${chapters} chapters x ` +
      `${sections} sections, ${(text.length / 1024).toFixed(0)} KB`,
  );
  console.log("remember: it must be listed in val.modules.ts");
} else {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}
