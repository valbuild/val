// No hooks in this file, and no "use client": `@valbuild/next` renders it from
// a Server Component, where the value still carries its components. What has
// hooks - the editing on the page - is `ValComponentEditorChrome.tsx`.
import {
  componentOfValue,
  componentPropsOf,
  Internal,
  loadComponent,
  type ComponentRender,
  type ValComponent,
} from "@valbuild/core";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  VAL_COMPONENT_ATTRIBUTE,
  ValComponentList,
} from "./ValComponentEditorChrome";

/**
 * EXPERIMENTAL: see {@link ValComponentEditor}.
 */
export type ValComponentEditorProps = {
  /**
   * What to render: an object linked to a component
   * (`s.object(...).component(...)`), or a list of them - as `useVal`,
   * `useValRoute` or `fetchVal` gave it back.
   *
   * Typed as {@link ValComponent}, which only a linked object reads as. A
   * list with one kind that has no component, or an object that never had
   * one, does not compile here.
   */
  value: ValComponent | readonly ValComponent[] | null;
  /** On the element around a LIST. Not used for a single object. */
  className?: string;
  /** On the element around each component. */
  itemClassName?: string;
  /**
   * Shown while a component's code is on its way: each is a lazy `import()`,
   * so the first time a kind of section is shown its chunk is fetched.
   * Nothing by default.
   */
  fallback?: ReactNode;
};

/**
 * EXPERIMENTAL: renders content with the components its schema links it to.
 *
 * Each object is rendered by the component its own schema names
 * (`.component(() => import("./Hero"))`), with the props that schema's `props`
 * function makes of it - so there is no map from a `type` to a component to
 * keep, and none to forget a case in. A list renders every item in order; a
 * single object renders the one.
 *
 * In the Studio, on the page itself, a list can be arranged: a section is
 * dragged to another place, one is added between two others, one is taken
 * away. Outside the Studio none of that exists, and this is the components
 * and an element around each.
 *
 * It is optional. The same content can be read and rendered by hand, with a
 * `map` and a `switch`, and a page is free to use this for one list and not
 * for the rest of what it shows.
 *
 * The component is found on the VALUE, which the reader attached it to. So
 * render the value where it was read: one passed from a server component to
 * a client component arrives without it, like the module behind a `s.view()`.
 *
 * @example
 * const page = useValRoute(pageVal, {});
 * return <ValComponentEditor value={page.sections} />;
 */
export function ValComponentEditor({
  value,
  className,
  itemClassName,
  fallback = null,
}: ValComponentEditorProps): ReactNode {
  if (value === null || value === undefined) {
    return null;
  }
  if (isList(value)) {
    return (
      <ValComponentList
        path={Internal.valPathOf(value)}
        className={className}
        count={value.length}
      >
        {value.map((item, index) => (
          <ValComponentItem
            // A list item has no identity but its place
            key={index}
            value={item}
            className={itemClassName}
            fallback={fallback}
          />
        ))}
      </ValComponentList>
    );
  }
  return (
    <ValComponentItem
      value={value}
      className={itemClassName}
      fallback={fallback}
    />
  );
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function ValComponentItem({
  value,
  className,
  fallback,
}: {
  value: unknown;
  className?: string;
  fallback: ReactNode;
}) {
  const path = Internal.valPathOf(value);
  const render = componentOfValue(value);
  // The element is there whether or not there is something in it: it is the
  // item's place in the list, which the editing on the page counts by.
  const attributes = {
    className,
    // With no value: it marks the element, and its place says which item.
    [VAL_COMPONENT_ATTRIBUTE]: "",
    // The whole component is this object: a click on it that lands on no
    // field of its own opens the object.
    "data-val-path": path,
  };
  if (render === null) {
    warnNoComponent(value, path);
    return <div {...attributes} />;
  }
  const props = componentPropsOf(render, value);
  if (typeof props !== "object" || props === null) {
    Internal.log.error(
      `ValComponentEditor: the props of the component${path ? ` at ${path}` : ""} must be an object, got ${props === null ? "null" : typeof props}. Check what its \`props\` function returns.`,
    );
    return <div {...attributes} />;
  }
  const Component = lazyComponentOf(render);
  return (
    <div {...attributes}>
      <Suspense fallback={fallback}>
        <Component {...props} />
      </Suspense>
    </div>
  );
}

const lazyComponents = new WeakMap<
  ComponentRender<unknown>["component"],
  ComponentType<Record<string, unknown>>
>();

/**
 * One lazy component per thunk, kept: a new `lazy()` on every render is a new
 * component type every time, which React unmounts and mounts again - a
 * section that loses its state, and suspends, at every keystroke.
 */
function lazyComponentOf(
  render: ComponentRender<unknown>,
): ComponentType<Record<string, unknown>> {
  const existing = lazyComponents.get(render.component);
  if (existing) {
    return existing;
  }
  const created = lazy(async () => ({
    // Core cannot express a React component's type, and a render found on a
    // value has lost its relation to the schema `.component()` checked it
    // against. This assertion restores it; the props it is given are that
    // schema's, through `componentPropsOf`.
    default: (await loadComponent(render)) as ComponentType<
      Record<string, unknown>
    >,
  }));
  lazyComponents.set(render.component, created);
  return created;
}

const warned = new Set<string>();

/**
 * Said once per place, and only where there is someone to read it: in
 * production the types have already refused this, so what is left is a value
 * that lost its component on the way here.
 */
function warnNoComponent(value: unknown, path: string | undefined) {
  if (value === null || value === undefined) {
    // An item nobody has filled in yet: an editor just added it.
    return;
  }
  const key = path ?? "";
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  Internal.log.warn(
    `ValComponentEditor: nothing to render${path ? ` ${path}` : " a value"} with. ` +
      `Either its schema has no .component(), or the value was passed from a server component to a client component, which drops the component it carried. ` +
      `Render it in the component that read it.`,
  );
}
