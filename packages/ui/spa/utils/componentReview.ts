import {
  Internal,
  isPageRouter,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import type { StudioComponent } from "./collectComponents";

/**
 * The route in the host app that renders the value at one source path with
 * its component, alone (`src/routes/val-preview.tsx` in the TanStack example,
 * `app/val-preview/page.tsx` in the Next one).
 *
 * Hard-coded while the setup story is worked out, as it was for the preview
 * beside the fields: see `architecture/render-and-preview.md`.
 */
export const VAL_COMPONENT_PREVIEW_ROUTE = "/val-preview";

/**
 * Where the preview route renders `path`: its content, or with `example`,
 * the `.component(load, { example })` content instead - looked up through
 * `path`, since which component a union's item is depends on its value.
 */
export function componentPreviewUrl(
  path: SourcePath,
  example: boolean,
): string {
  const query = new URLSearchParams({ p: path });
  if (example) {
    query.set("example", "1");
  }
  return `${VAL_COMPONENT_PREVIEW_ROUTE}?${query.toString()}`;
}

/**
 * The page an instance is on, when its module is a router of this site's
 * pages: the route, which is the first key under the module's root.
 * `null` for a module that is not a page router.
 */
export function pageRouteOf(
  path: SourcePath,
  schemas: Record<ModuleFilePath, SerializedSchema>,
): string | null {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const root = schemas[moduleFilePath];
  if (
    root === undefined ||
    root.type !== "record" ||
    root.router === undefined ||
    !isPageRouter(root.router) ||
    !modulePath
  ) {
    return null;
  }
  const [route] = Internal.splitModulePath(modulePath);
  return route ?? null;
}

/**
 * Something to tell one instance from another by, read off its content when
 * there is no preview: its first non-empty string that is not its kind (a
 * union's tag is the same for every instance of a component).
 */
export function contentLabelOf(source: Json | undefined): string | null {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return null;
  }
  for (const value of Object.values(source)) {
    if (typeof value === "string" && value.trim().length > 0) {
      const text = value.trim();
      // A short lower-case word is a tag ("hero"), not something written
      if (/^[a-z][a-z0-9-]*$/.test(text) && text.length <= 20) {
        continue;
      }
      return text.length > 80 ? text.slice(0, 79) + "…" : text;
    }
  }
  return null;
}

/** Quick requests the view offers, each a sentence to the assistant. */
export const COMPONENT_REQUESTS: readonly { label: string; request: string }[] =
  [
    {
      label: "Review it",
      request:
        "Review this component: how it looks across the instances, on small screens, with long and empty content. List what you would change, and why, before changing anything.",
    },
    {
      label: "Fit small screens",
      request:
        "Make this component work well on a phone-sized screen, without changing how it looks on a wide one.",
    },
    {
      label: "Handle long content",
      request:
        "Make this component hold up with very long text and with optional content left empty.",
    },
  ];

/**
 * What the assistant is told when asked about a component from the
 * Components view: which component, where it is linked (so it can find the
 * `.component(...)` call and, through its `import()`, the component's file),
 * where it is used, which instance the editor is looking at, and the request.
 *
 * Plain prose: the assistant reads it as the editor's message.
 */
export function componentAssistantPrompt({
  component,
  shown,
  request,
}: {
  component: StudioComponent;
  /** The instance on screen, or the example. `null` when nothing is shown. */
  shown: { path: SourcePath; example: boolean } | null;
  request: string;
}): string {
  const lines: string[] = [];
  lines.push(`This is about the component "${component.name}".`);
  const [first, ...rest] = component.linkedAt;
  if (first !== undefined) {
    const where = (link: { moduleFilePath: string; at: string }) =>
      link.at === ""
        ? `the root schema of \`${link.moduleFilePath}\``
        : `\`${link.at}\` in the schema of \`${link.moduleFilePath}\``;
    lines.push(
      `It is linked with \`.component(() => import(...))\` on the object at ${where(first)}${
        rest.length > 0 ? `, and also at ${rest.map(where).join(", ")}` : ""
      }. The \`import()\` there names the component's file.`,
    );
  }
  const count = component.instances.length;
  if (count === 0) {
    lines.push("No content uses it yet.");
  } else {
    const listed = component.instances.slice(0, 20);
    lines.push(
      `It is used ${count === 1 ? "once" : `${count} times`} in the content: ${listed
        .map((path) => `\`${path}\``)
        .join(
          ", ",
        )}${count > listed.length ? `, and ${count - listed.length} more` : ""}.`,
    );
  }
  if (shown !== null) {
    lines.push(
      shown.example
        ? `I am looking at its example (the \`example\` given to \`.component(...)\`), rendered at ${componentPreviewUrl(shown.path, true)}.`
        : `I am looking at \`${shown.path}\`, rendered alone at ${componentPreviewUrl(shown.path, false)}.`,
    );
  }
  lines.push("", request.trim());
  return lines.join("\n");
}
