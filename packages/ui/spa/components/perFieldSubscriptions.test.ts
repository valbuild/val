import fs from "fs";
import path from "path";

/**
 * `useAllSources()` and `useSchemas()` are whole-project subscriptions.
 *
 * `getAllSourcesSnapshot()` walks every module, calls `getPatchedSource` and
 * `deepClone`s the result; `invalidateSource` drops its cache on every keystroke,
 * so the snapshot is a NEW object every time and `useSyncExternalStore` can never
 * bail out. A component that subscribes therefore re-renders - and forces a fresh
 * deep clone of the entire project - on every keystroke anywhere in the Studio.
 *
 * That is affordable in the handful of whole-project views that genuinely need all
 * sources (Search, Module, ValidationErrors, the reference hooks). It is NOT
 * affordable in a component mounted once per field: `Field` wraps every leaf field
 * in the editor, so subscribing there made a single keystroke cost
 * O(project size), for data that only a click handler ever read.
 *
 * This is a STATIC guard, not a behavioural one: `packages/ui` has no
 * `jest-environment-jsdom`, so no component can be rendered in this suite. If that
 * changes, replace this with a render test that counts commits.
 *
 * Components here must use `useGetNavPath()` (or another on-demand read) instead.
 */
const PER_FIELD_COMPONENTS = ["Field.tsx", "FieldValidationError.tsx"];

const WHOLE_PROJECT_HOOKS = ["useAllSources", "useSchemas"];

describe("per-field components do not subscribe to the whole project", () => {
  for (const file of PER_FIELD_COMPONENTS) {
    for (const hook of WHOLE_PROJECT_HOOKS) {
      test(`${file} does not call ${hook}()`, () => {
        const source = fs.readFileSync(path.join(__dirname, file), "utf-8");
        expect(source).not.toContain(`${hook}(`);
      });
    }
  }
});
