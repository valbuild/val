import { createFileRoute, redirect } from "@tanstack/react-router";
import { useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import { getSessionUser } from "../auth/session";
import pageVal from "./_site.dashboard.val";

/**
 * A page behind a login, the way a dashboard or an intranet is.
 *
 * `beforeLoad` asks the server who is signed in and sends anyone who is not to
 * `/login`, carrying the whole `href` — query string included — so they come
 * back to exactly where they were. Val does not depend on that: a page in the
 * Studio's canvas is the canvas wherever the site sends it, `?val_canvas=1` or
 * not (see `isValCanvasFrame`).
 */
export const Route = createFileRoute("/_site/dashboard")({
  beforeLoad: async ({ location }) => {
    const user = await getSessionUser();
    if (user === null) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user };
  },
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();
  const page = useValRoute(pageVal, {});
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main>
      <h1>{page.title}</h1>
      <p>Signed in as {user}</p>
      <p>{page.welcome}</p>
    </main>
  );
}
