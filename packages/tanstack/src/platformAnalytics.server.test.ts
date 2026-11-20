/**
 * @jest-environment node
 */
import {
  analyticsFromDevelopment,
  analyticsOfThisPage,
} from "./platformAnalytics";

/**
 * The server render, where there is no document: what the platform handed
 * this isolate, or else -- on the development server alone -- the app's own
 * `VAL_ANALYTICS`, so a developer sees what analytics does to their pages.
 */
describe("content analytics on the development server", () => {
  let before: NodeJS.ProcessEnv;
  beforeEach(() => {
    before = process.env;
    process.env = { ...before, NODE_ENV: "development" };
    Reflect.deleteProperty(globalThis, "__PLATFORM_SECRETS");
  });
  afterEach(() => {
    process.env = before;
    Reflect.deleteProperty(globalThis, "__PLATFORM_SECRETS");
  });

  test("on with VAL_ANALYTICS=true, with the content version when there is one", () => {
    expect(analyticsFromDevelopment()).toBeNull();
    process.env["VAL_ANALYTICS"] = "true";
    expect(analyticsFromDevelopment()).toEqual({ enabled: true });
    process.env["VAL_CONTENT_VERSION"] = "showcase-dev";
    expect(analyticsFromDevelopment()).toEqual({
      enabled: true,
      contentVersion: "showcase-dev",
    });
    process.env["VAL_ANALYTICS"] = "false";
    expect(analyticsFromDevelopment()).toBeNull();
  });

  test("never outside the development server, whatever the build baked in", () => {
    process.env["VAL_ANALYTICS"] = "true";
    process.env = { ...process.env, NODE_ENV: "production" };
    expect(analyticsFromDevelopment()).toBeNull();
    expect(analyticsOfThisPage()).toBeNull();
  });

  test("the server render reads it, and the platform's setting over it", () => {
    process.env["VAL_ANALYTICS"] = "true";
    process.env["VAL_CONTENT_VERSION"] = "showcase-dev";
    expect(analyticsOfThisPage()).toEqual({
      enabled: true,
      contentVersion: "showcase-dev",
    });
    Reflect.set(globalThis, "__PLATFORM_SECRETS", {
      VAL_ANALYTICS: "true",
      VAL_CONTENT_VERSION: "e3b0c442",
    });
    expect(analyticsOfThisPage()).toEqual({
      enabled: true,
      contentVersion: "e3b0c442",
    });
  });
});
