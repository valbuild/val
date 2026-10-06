import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Suspense } from "react";
import { ValModulesClient, ValProvider } from "@valbuild/tanstack";
import { config } from "../../val.config";
import valModules from "../../val.modules";
import { fetchValDraft } from "../val/server";

/**
 * The draft this request renders, when an editor is previewing; `null` for
 * everyone else, after one cookie lookup.
 *
 * Through `createServerFn` for the reason `_site.docs.$.tsx` gives: a loader
 * runs in the browser too, and `../val/server` must not end up there.
 */
const getValDraft = createServerFn().handler(() => fetchValDraft());

/**
 * The site's own layout — everything except Val Studio.
 *
 * A pathless layout (`_site`), so it adds no URL segment: `_site.index.tsx` is
 * still `/` and `_site.posts.$postId.tsx` is still `/posts/$postId`. Val
 * modules named after those files inherit the same rule, so
 * `_site.posts.$postId.val.ts` holds `/posts/...` keys.
 *
 * Keeping it out of `__root` is what keeps the site's chrome — and the Studio
 * overlay this mounts — off the `/val` route.
 */
export const Route = createFileRoute("/_site")({
  /*
   * On the server only. The draft is for the render that has no other way to
   * get it -- the first one, and the browser's hydration of it, which reuses
   * this loader's data. After that the overlay keeps the page up to date, so a
   * client navigation reads nothing and asks the server for nothing.
   */
  loader: () => (typeof document === "undefined" ? getValDraft() : null),
  component: SiteLayout,
});

function SiteLayout() {
  const draft = Route.useLoaderData();
  return (
    /*
     * Everything the site renders goes inside ValProvider: it mounts the Studio
     * overlay, receives edits from it, and re-runs the loaders when one lands.
     *
     * `suspend` opts into the Suspense gate, so a route that exists only in an
     * unpublished draft renders instead of 404ing. Visitors without the Val
     * Enable cookie pay nothing for it.
     *
     * `draft` is what the server rendered this page with, so the browser's
     * first render agrees with it and a draft never shows the published text
     * first.
     */
    <ValProvider config={config} suspend draft={draft}>
      {/* Hands the Studio your schemas. Needed here AND on the /val route. */}
      <ValModulesClient modules={valModules} />
      <nav>
        <Link to="/">Home</Link>
        <Link to="/posts/$postId" params={{ postId: "hello-world" }}>
          A post
        </Link>
        <Link to="/docs/$" params={{ _splat: "getting-started" }}>
          Docs
        </Link>
        <Link to="/showcase">Showcase</Link>
        <Link
          to="/{-$locale}/news/$slug"
          params={{ locale: "nb", slug: "val-pa-norsk" }}
        >
          Nyheter
        </Link>
        <a href="/val">Val Studio</a>
      </nav>
      {/*
       * A Suspense boundary, because `suspend` above means the hooks can
       * suspend.
       *
       * Not optional: with no boundary between a suspending component and the
       * root, React has nowhere to show a fallback and the whole tree — the
       * provider's own state included — stops updating, which looks like the
       * Studio failing to load. TanStack Start gives you no boundary of its
       * own, so this is the app's job.
       */}
      <Suspense fallback={<main>Loading…</main>}>
        <Outlet />
      </Suspense>
    </ValProvider>
  );
}
