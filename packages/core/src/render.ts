import type { Schema, SerializedSchema } from "./schema";
import type { SelectorSource } from "./selector";

/**
 * THE RULE, and the only sentence that needs to be remembered:
 *
 *   **`.describe()` is INPUT HELP and is shown wherever that field — or a
 *   record's key — is being ENTERED; `.preview()` is a NAME and is shown
 *   wherever the value is REFERRED TO rather than edited; `.render()` is
 *   LAYOUT and applies only while the field is open in front of you.**
 *
 * The test that settles every case: **can the reader change something here?**
 * If yes it is a place for a description — the input beside a label, the key
 * box in "New entry", "Rename key", "Duplicate", "New page", the key half of a
 * reference dropdown. If no, it is a place for a preview — a list row, a
 * reference once chosen, a search hit, a sitemap row, the heading of what you
 * navigated to.
 *
 * That is why a description is plain data on the serialized schema and a
 * preview is a closure: a description is true before any value exists and says
 * the same thing to everyone filling the field in, and a preview cannot exist
 * without the one value it names. So a description must never be used as a
 * subtitle — it would repeat one sentence under every row of a list — and a
 * preview must never be used as help text, because there is nothing to preview
 * until after the value has been entered.
 *
 * None of the three substitutes for another: a field with a perfect
 * description still previews as `#3` until someone writes the preview.
 */
/**
 * A RENDER is how a field is laid out in the editor, and it applies only when
 * you are looking at the field. On a list it is declared by the CONTAINER about
 * its children, never by a child about itself: `s.array(item).render({ as: "inline" })`
 * and `s.record(item).render({ as: "inline" })`. Three other schemas take a
 * render, each meaning something of its own: `s.keyOf(...)` (see
 * `KeyOfSchema.render`), `s.number()` / `s.int()`, whose `{ as: "slider" }`
 * is a different input for the same value (see {@link SliderRender}), and -
 * EXPERIMENTAL - `s.object(...)`, whose `{ as: "component" }` names the
 * component that renders it on the site (see {@link ComponentRender}).
 *
 * Why the container: inline is a property of the LIST — "my items are edited in
 * their rows" — and the item schema is the wrong place to say it. An item can be
 * reused in a list that wants preview rows and one that wants forms; a tagged
 * union had to be declared inline on every variant (or on any one of them,
 * which was worse); and a schema that was not an item carried a setting that
 * did nothing. Putting it on the container makes all three go away.
 *
 * It is deliberately the ONE thing a render can say. What a string looks like
 * when it holds more than a line is the schema's own business — `.multiline()`
 * for a text box, `s.code({ language })` for a code editor — not a layout
 * bolted onto `s.string()` from outside.
 *
 * A PREVIEW (`preview.ts`) is the other thing: how the VALUE is shown wherever
 * a preview of it is needed — a list row, a reference dropdown, a search hit —
 * that is, wherever the value is navigable to rather than open. The two never
 * intersect: a schema can carry both, a `render` is read where the field is
 * edited and a `preview` where the value is previewed. A second `.render(...)`
 * on the same schema REPLACES the first (last one wins), exactly like a second
 * `.preview(...)` replaces the first — they do not merge.
 *
 * A render is static configuration - plain data, with no closure behind it and
 * no dependency on source - which is why it lives in the SERIALIZED schema
 * (`SerializedArraySchema.render`) and is read straight off it where the field
 * is drawn. There is no render pipeline, no store and no host round-trip.
 *
 * That "static" is an ASSUMPTION we are taking deliberately, for simplicity,
 * not a law. A future render could plausibly want to depend on source - a
 * layout that varies with the value, a callback of its own. If that day comes,
 * the shape it needs back is `executePreview`'s, and the honest move is to give
 * `render` its own execute/store pair again. It is NOT to re-merge the two:
 * conflating them is what this file was split up to undo.
 */
/**
 * `{ as: "inline" }` on an array or record: the container renders each of its
 * DIRECT items' own editor inside its (sortable) row, instead of a clickable
 * preview row that navigates to it. This is what a page-builder list is made
 * of: `s.array(s.discriminatedUnion("type", hero, text)).render({ as: "inline" })`.
 *
 * It reaches one level down and no further: in
 * `s.array(s.object({ tags: s.array(s.string()) })).render({ as: "inline" })`
 * the objects are inline and `tags` keeps its own default.
 *
 * Not available on `s.router(...)`, `s.imagedir(...)` or `s.filedir(...)`:
 * pages and media have UIs of their own, and `RecordSchema.render` throws there.
 *
 * On `s.keyOf(...)` the same value means something else: the selected entry's
 * content is shown below the selector. That is the keyOf field's own layout,
 * and is not read by any list.
 */
export type InlineRender = { as: "inline" };

/**
 * What `.render(...)` takes, and what the serialized schema carries verbatim.
 */
export type FieldRender = InlineRender;

/**
 * `{ as: "slider", min, max }` on `s.int()` or `s.number()`: the value is
 * edited with a slider from `min` to `max`, next to a box that takes a typed
 * value.
 *
 * `min` and `max` are REQUIRED, because a slider without ends is not a slider.
 * They are the slider's own and are not validation: a value outside them is
 * still valid content (if the schema allows it), and the field says it is out
 * of the slider's reach and offers to bring it back. What the schema accepts is
 * `.min()`, `.max()` and `.step()` on the schema itself.
 *
 * The one rule tying the two together: **the slider may only produce values
 * the schema accepts.** So its range has to lie inside the schema's, its step
 * has to be a multiple of the schema's step and its `min` on the schema's grid,
 * and on `s.int()` all of them have to be whole numbers. A schema that breaks
 * that throws where it is defined — see `NumberSchema`.
 *
 * `step` defaults to the schema's `.step()`, and to 1 when there is none.
 *
 * Unlike `inline` this is about the field itself — no list reads it, and
 * {@link isInlineRender} answers `false` for it.
 */
export type SliderRender = {
  as: "slider";
  min: number;
  max: number;
  step?: number;
};

/**
 * What `s.number().render(...)` and `s.int().render(...)` take.
 */
export type NumberRender = SliderRender;

/**
 * Does this CONTAINER edit its items inside their list rows, rather than behind
 * clickable preview rows that navigate to them?
 *
 * Pass the array or record — never the item. Anything else answers `false`,
 * `s.keyOf` included: its render is about the keyOf field, not about a list.
 *
 * The one answer, so that the list rows, the nav-stop rule (`getNavPath`) and
 * the add buttons cannot drift apart — they are three readings of the same
 * question, and a disagreement between them is a row you can edit in place but
 * that "add" navigates away from.
 *
 * It stays static (see the top of this file): the answer is a function of the
 * serialized schema alone, never of the value the row happens to hold.
 */
export function isInlineRender(container: SerializedSchema): boolean {
  if (container.type !== "array" && container.type !== "record") {
    return false;
  }
  return container.render?.as === "inline";
}

/**
 * EXPERIMENTAL. A React (or any) component, typed loosely because core knows
 * nothing about React. `never` in the parameter position accepts a component
 * of any props, since parameters are contravariant.
 */
export type ValComponent = (props: never) => unknown;

/**
 * What the `component` thunk of a {@link ComponentRender} resolves to: the
 * component itself, or a module whose default export is the component.
 */
export type ValComponentImport = ValComponent | { default: ValComponent };

/**
 * EXPERIMENTAL. `{ as: "component", component, example? }` on `s.object(...)`:
 * the component that renders this object on the site, so the Studio can show
 * it, rendered by the app, next to the fields of the object being edited.
 *
 * Unlike every other render this one holds a CLOSURE - the `component` thunk -
 * so, exactly like a preview, only a marker travels in the serialized schema
 * ({@link SerializedComponentRender}) and the component is rendered by the
 * host app, which has the schema instance.
 *
 * `component` is a lazy `import()` rather than the component itself. A
 * `.val.ts` may not import app code (`@valbuild/eslint-plugin`'s
 * `no-illegal-imports`), because Val evaluates val files outside of the app -
 * `val validate`, the language server and the Studio all do - and a component
 * pulls in CSS, images and framework code none of those can load. A thunk is
 * never called there, so the component's file is never loaded either.
 *
 * `example` is content to preview the component with that is not on the site:
 * a fixture, and a good place for deliberately unrepresentative values (very
 * long titles, empty lists) that make layout problems easy to spot.
 */
export type ComponentRender<Src> = {
  as: "component";
  component: () => Promise<ValComponentImport>;
  example?: Src;
  /**
   * The widest the component is shown, in CSS pixels. The preview is the
   * component's whole viewport, so this is also the width its media queries
   * see: a card designed for a 400px column says `maxWidth: 400` and is not
   * stretched across the editor.
   *
   * Without it the preview is as wide as there is room for.
   */
  maxWidth?: number;
  /**
   * Width divided by height, e.g. `16 / 9`, for a component that fills the
   * space it is given rather than having a height of its own - a full-bleed
   * hero, a background video. The preview is then that shape.
   *
   * Without it the preview is as tall as what the component renders.
   */
  aspectRatio?: number;
  /**
   * How the Studio shows the value to begin with: `"preview"` (the component
   * alone), `"content"` (the fields alone) or `"split"` (the two side by side).
   * Split starts on a phone-wide preview, which leaves the fields the most
   * room, and pressing Split again moves to an iPad and then a desktop, scaled
   * down to fit. The editor can switch on the field.
   *
   * Defaults to `"split"`.
   */
  defaultView?: ComponentView;
};

/** How the Studio shows a value that has a component. See {@link ComponentRender}. */
export type ComponentView = "preview" | "content" | "split";

/**
 * What a {@link ComponentRender} serializes to. The component is a closure and
 * cannot travel; `example` says whether there is one to preview with. The
 * sizes are plain numbers and travel whole: the Studio lays the preview out
 * with them.
 */
export type SerializedComponentRender = {
  as: "component";
  example?: true;
  maxWidth?: number;
  aspectRatio?: number;
  defaultView?: ComponentView;
};

/**
 * The messages between the Studio and the host app's preview route, which run
 * in different frames. Both sides read them from here so they cannot drift.
 *
 * - `refresh`: Studio to preview. The content changed; render it again.
 * - `size`: preview to Studio, with `{ height }`. What the component rendered
 *   is this tall, so the Studio can size the frame to fit it.
 */
export const VAL_PREVIEW_MESSAGES: {
  refresh: "val-preview-refresh";
  size: "val-preview-size";
} = {
  refresh: "val-preview-refresh",
  size: "val-preview-size",
};

/**
 * Throws, where the schema is defined, on sizes no preview could be laid out
 * with - the same place the slider's range is checked, and for the same
 * reason: a mistake here is a developer's, and the definition is where they
 * can see it.
 */
export function assertComponentRenderIsConsistent(
  render: ComponentRender<unknown>,
): void {
  const views: ComponentView[] = ["preview", "content", "split"];
  if (
    render.defaultView !== undefined &&
    !views.some((view) => view === render.defaultView)
  ) {
    throw new Error(
      `render({ as: "component" }): defaultView must be one of ${views.join(", ")}, got ${String(render.defaultView)}`,
    );
  }
  for (const key of ["maxWidth", "aspectRatio"] as const) {
    const value = render[key];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new Error(
        `render({ as: "component" }): ${key} must be a positive number, got ${value}`,
      );
    }
  }
}

/**
 * EXPERIMENTAL: the component that renders a value of `schema` whose source is
 * `src`, or `null` when there is none. A discriminated union answers for the
 * variant `src` takes, which is what a list of page sections needs.
 */
export function getComponentRender(
  schema: Schema<SelectorSource>,
  src: unknown,
): ComponentRender<unknown> | null {
  return schema["executeComponentRender"](src);
}

/**
 * EXPERIMENTAL: call a {@link ComponentRender}'s thunk and unwrap a module's
 * default export.
 */
export async function loadComponent(
  render: ComponentRender<unknown>,
): Promise<ValComponent> {
  const imported = await render.component();
  return typeof imported === "function" ? imported : imported.default;
}
