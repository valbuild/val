/**
 * @jest-environment jsdom
 */

/**
 * Content analytics as Val's hosting sets it: what a site whose layout passes
 * `<ValProvider>` nothing gets, from the `VAL_ANALYTICS` secret alone. The
 * server render reads what the platform handed it and writes it into the
 * page; the browser reads that back, and hydrates the same element.
 */
describe("content analytics from Val's hosting", () => {
  let platform: typeof import("./platformAnalytics");
  beforeEach(async () => {
    // The browser half remembers what the page said: each test is a new page.
    jest.resetModules();
    platform = await import("./platformAnalytics");
    document.body.innerHTML = "";
    Reflect.deleteProperty(globalThis, "__PLATFORM_SECRETS");
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "__PLATFORM_SECRETS");
  });

  const handOver = (secrets: Record<string, string>) =>
    Reflect.set(globalThis, "__PLATFORM_SECRETS", secrets);

  test("on, with the content version, when the platform says so", () => {
    handOver({ VAL_ANALYTICS: "true", VAL_CONTENT_VERSION: "e3b0c442" });
    expect(platform.analyticsFromPlatform()).toEqual({
      enabled: true,
      contentVersion: "e3b0c442",
    });
    handOver({ VAL_ANALYTICS: "true" });
    expect(platform.analyticsFromPlatform()).toEqual({ enabled: true });
  });

  test("nothing when it is off, or outside Val's hosting, whatever the build baked in", () => {
    handOver({ VAL_ANALYTICS: "false", VAL_CONTENT_VERSION: "e3b0c442" });
    expect(platform.analyticsFromPlatform()).toBeNull();
    Reflect.deleteProperty(globalThis, "__PLATFORM_SECRETS");
    process.env["VAL_ANALYTICS"] = "true";
    try {
      expect(platform.analyticsFromPlatform()).toBeNull();
    } finally {
      delete process.env["VAL_ANALYTICS"];
    }
  });

  test("what the server writes, the browser reads back, and hydrates without a mismatch", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { act } = await import("react");
    handOver({ VAL_ANALYTICS: "true", VAL_CONTENT_VERSION: "e3b0c442" });
    const value = platform.analyticsFromPlatform();
    if (value === null) throw new Error("expected the platform's setting");
    const html = renderToString(<platform.PlatformAnalytics value={value} />);
    expect(html).toBe(
      `<script type="application/json" id="__val_analytics">{"enabled":true,"contentVersion":"e3b0c442"}</script>`,
    );

    // The browser: no secrets, only the page.
    Reflect.deleteProperty(globalThis, "__PLATFORM_SECRETS");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const read = platform.analyticsOfThisPage();
    expect(read).toEqual(value);
    if (read === null) throw new Error("expected the page's setting");

    // A mismatch is reported to `onRecoverableError`, or logged.
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});
    const errors: unknown[] = [];
    try {
      const root = await act(async () =>
        hydrateRoot(container, <platform.PlatformAnalytics value={read} />, {
          onRecoverableError: (error) => errors.push(error),
        }),
      );
      await act(async () => root.unmount());
      expect(errors).toEqual([]);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });

  test("the page keeps what it said after the provider that wrote it is gone", () => {
    document.body.innerHTML = `<script type="application/json" id="__val_analytics">{"enabled":true}</script>`;
    expect(platform.analyticsFromPage()).toEqual({ enabled: true });
    document.body.innerHTML = "";
    expect(platform.analyticsFromPage()).toEqual({ enabled: true });
  });

  test.each([
    ["no element", ""],
    [
      "not JSON",
      `<script type="application/json" id="__val_analytics">{</script>`,
    ],
    [
      "not on",
      `<script type="application/json" id="__val_analytics">{"enabled":false}</script>`,
    ],
  ])("%s in the page is off", (_, body) => {
    document.body.innerHTML = body;
    expect(platform.analyticsFromPage()).toBeNull();
  });

  test("nothing a content version holds can end the element it is written in", () => {
    expect(
      platform.embeddableJson({ enabled: true, contentVersion: "</script>" }),
    ).toBe('{"enabled":true,"contentVersion":"\\u003c/script>"}');
  });
});
