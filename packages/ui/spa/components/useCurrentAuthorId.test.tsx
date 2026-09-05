/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";

/*
 * `createValSystem` reaches the validation worker bridge, which is ESM-only and
 * cannot be `require`d by jest on this Node version. It is not on the path
 * under test — `useCurrentAuthorId` reads a React context and nothing else — so
 * it is stubbed to make the module importable rather than to change behaviour.
 */
jest.mock("../stores/react/createValSystem", () => ({
  createValSystem: () => {
    throw new Error("not used by this test");
  },
}));

import { useCurrentAuthorId } from "./ValProvider";

/**
 * `useCurrentAuthorId` outside a `ValProvider`.
 *
 * The default `ValContext` is a Proxy that throws on any property read, so
 * every hook reading it crashes without a provider. That is the right guard for
 * a hook that genuinely cannot work — but this one can: "who is the current
 * author" has a correct answer when nobody is mounted, and it is nobody.
 *
 * A regression test, not a hypothetical. #548 made `CompareSummaryStrip` call
 * this hook to name authors, which took down EVERY `ComparePatchSets` story and
 * render — including ones with nothing to do with authorship — because one
 * presentational component deep in the tree reached for the author. A component
 * that renders on its own has to keep rendering on its own.
 */
function ShowsAuthor() {
  const authorId = useCurrentAuthorId();
  return <span data-testid="author">{authorId ?? "nobody"}</span>;
}

test("answers null outside a ValProvider instead of throwing", () => {
  render(<ShowsAuthor />);
  expect(screen.getByTestId("author").textContent).toBe("nobody");
});

/*
 * There is deliberately no test for "a real error from a mounted provider is
 * not swallowed".
 *
 * The first version of this fix wrapped the destructure in `try`/`catch`, which
 * answered "nobody" for ANY error raised while reading the context — so a
 * genuinely broken provider would have rendered as a logged-out user with the
 * stack trace gone. Copilot flagged it on #584 and it was right.
 *
 * Recognising the no-provider context by identity removed the catch rather than
 * narrowing it, so there is no longer a code path that could swallow anything.
 * A test for it would have to build its own throwing Proxy and assert that
 * Proxies throw, which is a test of JavaScript rather than of this hook.
 */
