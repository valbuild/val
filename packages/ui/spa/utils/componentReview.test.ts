import {
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import type { StudioComponent } from "./collectComponents";
import {
  componentAssistantPrompt,
  componentPreviewUrl,
  contentLabelOf,
  pageRouteOf,
} from "./componentReview";

const hero: StudioComponent = {
  id: "abc",
  name: "Hero",
  named: false,
  hasExample: true,
  linkedAt: [
    {
      moduleFilePath: "/src/routes/_site.landing.val.ts" as ModuleFilePath,
      at: "*.sections.*",
    },
    { moduleFilePath: "/other.val.ts" as ModuleFilePath, at: "" },
  ],
  instances: [
    '/src/routes/_site.landing.val.ts?p="/landing"."sections".0' as SourcePath,
    "/other.val.ts" as SourcePath,
  ],
};

describe("componentPreviewUrl", () => {
  test("the path in the query, and example when asked", () => {
    const path = '/page.val.ts?p="sections".0' as SourcePath;
    const url = new URL(componentPreviewUrl(path, true), "http://site");
    expect(url.pathname).toBe("/val-preview");
    expect(url.searchParams.get("p")).toBe(path);
    expect(url.searchParams.get("example")).toBe("1");
    expect(
      new URL(componentPreviewUrl(path, false), "http://site").searchParams.has(
        "example",
      ),
    ).toBe(false);
  });
});

describe("pageRouteOf", () => {
  test("the route of a page router's entry, and null otherwise", () => {
    const schemas: Record<ModuleFilePath, SerializedSchema> = {
      ["/pages.val.ts" as ModuleFilePath]: {
        type: "record",
        item: { type: "object", items: {}, opt: false },
        opt: false,
        router: "next-app-router",
      },
      ["/plain.val.ts" as ModuleFilePath]: {
        type: "record",
        item: { type: "object", items: {}, opt: false },
        opt: false,
      },
    };
    expect(
      pageRouteOf(
        '/pages.val.ts?p="/blog/a"."sections".0' as SourcePath,
        schemas,
      ),
    ).toBe("/blog/a");
    expect(pageRouteOf('/plain.val.ts?p="a"' as SourcePath, schemas)).toBe(
      null,
    );
    expect(pageRouteOf("/missing.val.ts" as SourcePath, schemas)).toBe(null);
  });
});

describe("contentLabelOf", () => {
  test("the first string that is written, not the kind", () => {
    expect(contentLabelOf({ type: "hero", title: "Ship content" })).toBe(
      "Ship content",
    );
    expect(contentLabelOf({ count: 3 })).toBe(null);
    expect(contentLabelOf(null)).toBe(null);
    expect(contentLabelOf({ text: "x".repeat(100) })?.length).toBe(80);
  });
});

describe("componentAssistantPrompt", () => {
  test("says which component, where it is linked and used, what is shown, and the request", () => {
    const prompt = componentAssistantPrompt({
      component: hero,
      shown: { path: hero.instances[0], example: false },
      request: "Make the title bigger. ",
    });
    expect(prompt).toContain('the component "Hero"');
    expect(prompt).toContain(
      "`*.sections.*` in the schema of `/src/routes/_site.landing.val.ts`",
    );
    expect(prompt).toContain("the root schema of `/other.val.ts`");
    expect(prompt).toContain("used 2 times");
    expect(prompt).toContain(`I am looking at \`${hero.instances[0]}\``);
    expect(prompt.endsWith("\n\nMake the title bigger.")).toBe(true);
  });

  test("the example, and a component nothing uses", () => {
    const prompt = componentAssistantPrompt({
      component: { ...hero, instances: [] },
      shown: { path: hero.instances[0], example: true },
      request: "Review it",
    });
    expect(prompt).toContain("No content uses it yet.");
    expect(prompt).toContain("looking at its example");
  });
});
