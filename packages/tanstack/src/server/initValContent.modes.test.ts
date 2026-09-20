import { initVal, type ValModules } from "@valbuild/core";

/**
 * The readers are configured SEPARATELY, and that is the whole finding.
 *
 * `initValContent` builds a Val server of its own -- it resolves content by
 * asking it, not by calling the API over HTTP -- so a host that configures
 * `initValServer` and nothing here leaves this half of Val inferring a mode.
 * On a host with no filesystem that is a reader looking for a working tree
 * that is not there, and it went unnoticed because a published read still
 * worked.
 *
 * It holds for both non-default modes, which is why this file covers both:
 * `sourceFiles` selects memory mode, `http` selects http mode, and neither
 * reaches these readers unless it is handed to them here.
 *
 * Asserted at the seam rather than through a rendered draft: what has to hold
 * is that the options REACH `createValServer`. A test that drove the fetchers
 * would need a request context, a session cookie and draft mode on, and would
 * still be asserting this.
 */

// `mock`-prefixed so jest allows the factory below to close over it: the
// factory is hoisted above every other statement in the file.
//
// The parameters are named rather than a rest array so that reading the third
// one back is typed, which is the whole assertion here.
const mockCreateValServer = jest.fn(
  (
    _valModules: unknown,
    _route: unknown,
    _options: Record<string, unknown>,
    ..._rest: unknown[]
    // Never settles, so nothing here depends on a real server being buildable.
  ): Promise<never> => new Promise(() => {}),
);
jest.mock("@valbuild/server", () => ({
  ...jest.requireActual("@valbuild/server"),
  createValServer: (
    valModules: unknown,
    route: unknown,
    options: Record<string, unknown>,
    ...rest: unknown[]
  ) => mockCreateValServer(valModules, route, options, ...rest),
}));

import { initValContent } from "./initValContent";

const { s, c, config } = initVal();

const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({
          default: c.define("/content/test.val.ts", s.string(), "hello"),
        }),
    },
  ],
};

const SOURCE = { "/content/test.val.ts": "export default 1" };

const HTTP = {
  apiKey: "key",
  valSecret: "secret",
  git: { commit: "0".repeat(40), branch: "main" },
};

const optionsPassed = (): Record<string, unknown> => {
  const call = mockCreateValServer.mock.calls.at(-1);
  if (!call) throw new Error("createValServer was never called");
  return call[2];
};

describe("initValContent and the host's own source", () => {
  beforeEach(() => mockCreateValServer.mockClear());

  test("sourceFiles reaches the reader's server", () => {
    initValContent(config, valModules, { sourceFiles: SOURCE });
    expect(optionsPassed().sourceFiles).toEqual(SOURCE);
  });

  test("...and so does the patch store, which has to be the SAME one", () => {
    // Two stores are two sets of pending edits: the API writes a patch into
    // one and the draft render reads the other and shows none of it.
    const patchStore = {} as never;
    initValContent(config, valModules, { sourceFiles: SOURCE, patchStore });
    expect(optionsPassed().patchStore).toBe(patchStore);
  });

  test("...and the host's claim to own authentication", () => {
    // Without it this reader checks a session the host never issues, answers
    // its own caller 401, and falls back to PUBLISHED content -- a draft
    // render showing the live site, which is the hardest kind of wrong to
    // notice.
    initValContent(config, valModules, {
      sourceFiles: SOURCE,
      unsafelyAllowUnauthenticated: true,
    });
    expect(optionsPassed().unsafelyAllowUnauthenticated).toBe(true);
  });

  test("a host that passes none of them is left exactly as it was", () => {
    // Absent, not `undefined`: `sourceFiles` is what SELECTS memory mode, so a
    // key present and undefined would be a different thing from no key.
    initValContent(config, valModules, {});
    expect("sourceFiles" in optionsPassed()).toBe(false);
    expect("patchStore" in optionsPassed()).toBe(false);
    expect("unsafelyAllowUnauthenticated" in optionsPassed()).toBe(false);
  });
});

describe("initValContent in http mode", () => {
  beforeEach(() => mockCreateValServer.mockClear());

  test("the http config reaches the reader's server", () => {
    initValContent(config, valModules, { http: HTTP });
    expect(optionsPassed()).toMatchObject(HTTP);
  });

  test("...including the commit, which decides WHICH content is read", () => {
    /*
     * The one field that is silently wrong rather than loudly missing.
     *
     * Producing the `.val.ts` mirror a publish commits means reading the
     * current text from the content service at this commit. A reader given a
     * different one from the API patches a different version of the same file
     * -- so the commit writes over content that is neither the draft nor what
     * the site is serving, with nothing failing anywhere.
     */
    initValContent(config, valModules, { http: HTTP });
    expect(optionsPassed().git).toEqual(HTTP.git);
  });

  test("a content url reaches it too, for a stand-in host", () => {
    initValContent(config, valModules, {
      http: { ...HTTP, valContentUrl: "http://localhost:4123" },
    });
    expect(optionsPassed().valContentUrl).toBe("http://localhost:4123");
  });

  test("a host that passes none of it is left exactly as it was", () => {
    initValContent(config, valModules, {});
    expect("apiKey" in optionsPassed()).toBe(false);
    expect("git" in optionsPassed()).toBe(false);
  });
});
