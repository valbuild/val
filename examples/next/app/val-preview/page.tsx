import { unstable_renderValComponent, ValPreviewRefresh } from "@valbuild/next";
import valModules from "../../val.modules";
import { fetchVal } from "../../val/rsc";

/**
 * EXPERIMENTAL: renders the value at one source path with the component its
 * schema declares (`.render({ as: "component", component })`).
 *
 * The Val UI loads this route in an iframe so that a component renders with the
 * app's own React, CSS and providers, and so that server components work.
 *
 * - `p` the source path to render, e.g. `/content/pages.val.ts?p="landing"."sections".0`
 * - `example=1` render the render's `example` instead of the content at `p`
 * - `props` explicit props as JSON (written as source), overriding both
 */
export default async function ValPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; example?: string; props?: string }>;
}) {
  const { p, example, props } = await searchParams;
  if (!p) {
    return <div>Missing ?p=&lt;source path&gt;</div>;
  }
  let parsedProps: unknown = undefined;
  if (props !== undefined) {
    try {
      parsedProps = JSON.parse(props);
    } catch (err) {
      return (
        <div style={{ fontFamily: "ui-monospace, monospace", padding: "1rem" }}>
          Could not parse props: {err instanceof Error ? err.message : "?"}
        </div>
      );
    }
  }
  return (
    <>
      <ValPreviewRefresh />
      {await unstable_renderValComponent({
        valModules,
        sourcePath: p,
        example: example === "1",
        props: parsedProps,
        fetchVal,
      })}
    </>
  );
}
