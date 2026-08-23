import { unstable_renderValComponent, ValPreviewRefresh } from "@valbuild/next";
import valModules from "../../val.modules";
import { fetchVal } from "../../val/rsc";

/**
 * EXPERIMENTAL: renders a single `c.component` module.
 *
 * The Val UI loads this route in an iframe so that a component renders with the
 * app's own React, CSS and providers, and so that server components work.
 *
 * - `c` component module path, e.g. `/app/sections/hero.val.tsx`
 * - `p` source path to take props from (defaults to `c`'s example content)
 * - `props` explicit props as JSON, overriding `p`
 */
export default async function ValPreviewPage({
  searchParams,
}: {
  searchParams: { c?: string; p?: string; props?: string };
}) {
  const { c, p, props } = searchParams;
  if (!c) {
    return <div>Missing ?c=&lt;component module path&gt;</div>;
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
        componentPath: c,
        sourcePath: p,
        props: parsedProps,
        fetchVal,
      })}
    </>
  );
}
