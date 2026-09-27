import { execFileSync } from "child_process";
import path from "path";

/**
 * `transformRemoveDevtools`, one case per way it can go wrong.
 *
 * Most of these are where the port departs from upstream on purpose: each is a
 * valid project upstream turns into a module that does not parse or does not
 * link, which in a publish is a build error on code that was fine. `parses` is
 * checked on every case because that is the failure all of them share.
 *
 * The transform runs in a child process because its parser is
 * `@rolldown/browser`'s, which is ESM-only, and jest runs CommonJS here. See
 * the probe beside this file.
 */

const cases = {
  template: `import { Outlet } from "@tanstack/react-router";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
export const C = () => (
  <main>
    <Outlet />
    <TanStackDevtools
      plugins={[{ name: "Router", render: <TanStackRouterDevtoolsPanel /> }]}
    />
  </main>
);
`,
  asi: `import { TanStackDevtools } from "@tanstack/react-devtools"
const panel = <TanStackDevtools />
const next = 1
`,
  panelUsedElsewhere: `import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
export const A = () => <TanStackDevtools plugins={[{ render: <TanStackRouterDevtoolsPanel /> }]} />;
export const B = () => <TanStackRouterDevtoolsPanel />;
`,
  sideEffect: `import "@tanstack/react-devtools";
export const x = 1;
`,
  devtoolsReadOutsideJsx: `import { TanStackDevtools } from "@tanstack/react-devtools";
export const Devtools = TanStackDevtools;
export const y = { TanStackDevtools };
`,
  defaultPanel: `import { TanStackDevtools } from "@tanstack/react-devtools";
import Panel, { other } from "./panel";
export const A = () => <TanStackDevtools plugins={[{ render: () => <Panel /> }]} />;
export { other };
`,
  keyIsNotARead: `import { TanStackDevtools } from "@tanstack/react-devtools";
export const o = { TanStackDevtools: 1, a: o.TanStackDevtools };
export const A = () => <div><TanStackDevtools /></div>;
`,
  untouched: `import { devtools } from "@tanstack/devtools-vite";
export default devtools();
`,
};

type Result = { code: string | null; parses: boolean };
let results: Record<string, Result>;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [
      path.join(__dirname, "__fixtures__", "removeDevtoolsProbe.ts"),
      JSON.stringify(cases),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // tsx's WASI warnings share stdout's stream in some shells; take the last
  // line that parses rather than assuming the output is only JSON.
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  results = JSON.parse(line!);
}, 300_000);

test.each(Object.keys(cases))("%s still parses", (name) => {
  expect(results[name]!.parses).toBe(true);
});

test("the template's layout loses the devtools and the router panel", () => {
  expect(results.template!.code)
    .toBe(`import { Outlet } from "@tanstack/react-router";
export const C = () => (
  <main>
    <Outlet />
      </main>
);
`);
});

test("a stand-in ends at the element, not at the newline after it", () => {
  // Upstream: `const panel = nullconst next = 1`. Without semicolons the
  // newline is the only thing ending the statement.
  expect(results.asi!.code).toBe(`const panel = null
const next = 1
`);
});

test("a panel rendered elsewhere keeps its import", () => {
  // Upstream deleted it because the devtools element named it, leaving `B`
  // rendering an unbound name.
  expect(results.panelUsedElsewhere!.code)
    .toBe(`import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
export const A = () => null;
export const B = () => <TanStackRouterDevtoolsPanel />;
`);
});

test("a bare side-effect import goes too", () => {
  // It has no names, and upstream returned early on "no names".
  expect(results.sideEffect!.code).toBe(`export const x = 1;
`);
});

test("a devtools name read outside JSX becomes a stub, not a dangling name", () => {
  expect(results.devtoolsReadOutsideJsx!.code)
    .toBe(`const TanStackDevtools = () => null;
export const Devtools = TanStackDevtools;
export const y = { TanStackDevtools };
`);
});

test("a default-imported panel goes, and the rest of its import stays", () => {
  expect(results.defaultPanel!.code).toBe(`import { other } from "./panel";
export const A = () => null;
export { other };
`);
});

test("a property named like the component is not a read of it", () => {
  // So the import is removed rather than stubbed.
  expect(results.keyIsNotARead!.code)
    .toBe(`export const o = { TanStackDevtools: 1, a: o.TanStackDevtools };
export const A = () => <div></div>;
`);
});

test("a package that only shares the prefix is left alone", () => {
  expect(results.untouched!.code).toBeNull();
});
