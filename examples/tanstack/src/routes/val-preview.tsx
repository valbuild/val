import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  Unstable_ValComponentPreview,
  ValPreviewBridge,
} from "@valbuild/tanstack";
import valModules from "../../val.modules";
import { fetchValPreviewSource } from "../val/server";

/**
 * Through `createServerFn` for the reason `_site.docs.$.tsx` gives: a loader
 * runs in the browser too, and `../val/server` must not end up there.
 */
const getPreviewSource = createServerFn()
  .validator((sourcePath: string) => sourcePath)
  .handler(({ data }) => fetchValPreviewSource(data));

/**
 * EXPERIMENTAL: renders the value at one source path with the component its
 * schema declares (`.render({ as: "component", component })`).
 *
 * The Val Studio loads this route in a frame, so a section renders with the
 * app's own React and CSS. Outside `_site`, so it is just the component: no
 * site chrome, and no `ValProvider`, which would take the frame for the
 * Studio's canvas.
 *
 * - `p` the source path to render
 * - `example=1` render the render's `example` instead of the content at `p`
 *
 * `ssr: false`: the edit tags that make a click open a field are switched on
 * by `ValPreviewBridge` in the browser, and a server render would be the one
 * render without them.
 */
export const Route = createFileRoute("/val-preview")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { p: string; example?: string } => ({
    p: typeof search.p === "string" ? search.p : "",
    ...(search.example !== undefined
      ? { example: String(search.example) }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ p: search.p }),
  loader: ({ deps }) => getPreviewSource({ data: deps.p }),
  component: ValPreviewPage,
});

function ValPreviewPage() {
  const source = Route.useLoaderData();
  const { example } = Route.useSearch();
  return (
    <ValPreviewBridge>
      <Unstable_ValComponentPreview
        valModules={valModules}
        source={source}
        example={example === "1"}
      />
    </ValPreviewBridge>
  );
}
