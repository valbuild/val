import fs from "fs";
import path from "path";

/**
 * A component mounted once per field may not subscribe to the whole project.
 *
 * ## What these hooks cost
 *
 * Each of them wakes on something that moves for reasons that have nothing to
 * do with the field reading it:
 *
 * - `useAllSources` / `useSchemas` — every keystroke anywhere, every schema
 *   change. `useAllSources`'s snapshot is a version NUMBER, so it cannot bail
 *   out: the reader re-renders whether or not its own answer moved.
 * - `useAllPreviews` — every preview computed or invalidated, project-wide.
 * - `useChainVersion` — every patch created, saved, dropped or fetched.
 * - `useLoadingStatus` — the WRITE QUEUE, so twice per save round trip.
 * - `useAllValidationErrors` — every validation result and invalidation.
 *
 * Any one of those is affordable in a whole-project view — Search, the errors
 * page, the nav tree. In a per-field component it makes a single edit
 * O(project), which is the cost the store layer exists to remove and which is
 * therefore trivial to reintroduce one level up. It has been reintroduced
 * twice, both times by an innocuous-looking hook two calls deep:
 * `useLoadingStatus` inside `useFieldState`, and `useAllSources` inside
 * `useRoutesOf` inside `useRichTextEditorConfig`.
 *
 * ## Why it is static
 *
 * `packages/ui` has no `jest-environment-jsdom` by default, so this suite
 * cannot render anything and count commits. `valFieldHooks.test.tsx` does that
 * for the hooks it covers; this is the cheap net over every field file, and it
 * catches the transitive case a render test would need a fixture for.
 *
 * ## Adding a file here
 *
 * Everything under `components/fields/` is covered automatically, so a new
 * field is guarded the day it is written. {@link EXTRA_FILES} is for the
 * per-field components that live elsewhere, and {@link ALLOWED} is the
 * escape hatch — with a reason, because an entry without one is how a guard
 * stops being one.
 */
const FIELDS_DIR = path.join(__dirname, "fields");

/**
 * Per-field components and hooks that do not live under `fields/`.
 *
 * Hooks belong here as much as components do: a hook every field calls is a
 * subscription every field has, and the call is one line in a file the guard
 * would otherwise never look at. `useProjectLocales` and `useEmptyOf` are here
 * because both were exactly that — the languages a project declares live in the
 * settings module, so reading them from source means `useSchemas` plus the
 * module, and every field and every filtered row asks. They read a context now;
 * the shell does the reading (see `useLocalesFromSettings`).
 */
const EXTRA_FILES = [
  "Field.tsx",
  "InlineField.tsx",
  "useFieldState.ts",
  "AnyField.tsx",
  "BlockList.tsx",
  "FieldValidationError.tsx",
  "FieldPatchAuthorsSection.tsx",
  "LocaleFilterProvider.tsx",
  "../hooks/useProjectLocales.tsx",
  "../hooks/useEmptyOf.ts",
];

/** Hooks that wake for something other than the field reading them. */
const WHOLE_PROJECT_HOOKS = [
  "useAllSources",
  "useSchemas",
  "useAllPreviews",
  "useChainVersion",
  "useLoadingStatus",
  "useAllValidationErrors",
];

/**
 * Known exceptions, each with the reason it is one.
 *
 * These are not "allowed because they are there". Every entry is a component
 * that genuinely needs a project-wide answer and pays for it with a snapshot
 * that is reference-stable, so an unchanged answer re-renders nothing.
 */
const ALLOWED: Record<string, { hooks: string[]; because: string }> = {
  // `useAllPreviews` returns the same object when no preview moved
  // (`PreviewStore.all` recomputes and compares), so an unrelated keystroke
  // costs one map rebuild and no render. The route selector genuinely needs
  // every router module's preview to label its options.
  "RouteField.tsx": {
    hooks: ["useAllPreviews"],
    because:
      "the route selector labels every route in the project, and PreviewStore.all() is reference-stable",
  },
  // Same reasoning, for the rich text link catalogue.
  "useRichTextEditorConfig.ts": {
    hooks: ["useAllPreviews"],
    because:
      "the link catalogue labels every route in the project, and PreviewStore.all() is reference-stable",
  },
  // `useAllValidationErrors` is reference-stable by recompute-and-compare (see
  // `ValErrorProvider`), and a compact row shows errors for a whole subtree
  // rather than for one path.
  "FieldValidationError.tsx": {
    hooks: ["useAllValidationErrors"],
    because:
      "the compact badge summarises a subtree, and useAllValidationErrors is reference-stable",
  },
  // A gallery and a record list are whole-MODULE views: each renders every
  // entry of the record it is pointed at and shows an error badge per row, so
  // a per-path read would be one subscription per tile. And
  // `useAllValidationErrors` is reference-stable by recompute-and-compare, so
  // an unchanged answer re-renders nothing.
  "ModuleGallery.tsx": {
    hooks: ["useAllValidationErrors"],
    because: "a gallery renders a whole record and badges each entry",
  },
  "RecordFields.tsx": {
    hooks: ["useAllValidationErrors"],
    because: "a record list renders every row and badges each one",
  },
};

/**
 * The file with its comments removed.
 *
 * Matched on the CODE, not on the text: three of these files explain in a doc
 * comment which hook they used to call and why they stopped, and a substring
 * test over the raw source reads those explanations as violations. Deleting the
 * explanation to satisfy the guard would be the worst possible outcome.
 */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function perFieldFiles(): string[] {
  const inFieldsDir = fs
    .readdirSync(FIELDS_DIR)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !file.includes(".test.") && !file.includes(".stories."))
    .map((file) => path.join("fields", file));
  return [...inFieldsDir, ...EXTRA_FILES];
}

describe("per-field components do not subscribe to the whole project", () => {
  for (const file of perFieldFiles()) {
    const base = path.basename(file);
    for (const hook of WHOLE_PROJECT_HOOKS) {
      const allowed = ALLOWED[base]?.hooks.includes(hook) === true;
      const name = allowed
        ? `${file} may call ${hook}(): ${ALLOWED[base].because}`
        : `${file} does not call ${hook}()`;
      test(name, () => {
        const calls = code(path.join(__dirname, file)).includes(`${hook}(`);
        expect(calls).toBe(allowed);
      });
    }
  }
});

/**
 * The rich text editor's config hook is not under `fields/`, and it is the one
 * that put `useAllSources` back on the keystroke path — two calls deep, through
 * `useRoutesOf`. Named explicitly so the transitive case is covered even though
 * the file itself is elsewhere.
 */
describe("the rich text editor config is a per-field hook", () => {
  const file = path.join(
    __dirname,
    "RichTextEditor/useRichTextEditorConfig.ts",
  );
  for (const hook of WHOLE_PROJECT_HOOKS) {
    const allowed =
      ALLOWED["useRichTextEditorConfig.ts"]?.hooks.includes(hook) === true;
    test(`${allowed ? "may" : "does not"} call ${hook}()`, () => {
      expect(code(file).includes(`${hook}(`)).toBe(allowed);
    });
  }
});
