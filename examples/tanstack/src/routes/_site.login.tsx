import {
  createFileRoute,
  useHydrated,
  useRouter,
} from "@tanstack/react-router";
import { signIn } from "../auth/session";

/**
 * Where `/dashboard` sends a visitor who is not signed in.
 *
 * Signs in and goes back to `redirect` in the browser, the way most sign-in
 * forms do — a client-side navigation, not a page load. The button waits for
 * hydration, because before it there is no handler and a click would submit
 * the form as a plain GET to this page.
 */
export const Route = createFileRoute("/_site/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  component: Login,
});

function Login() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const hydrated = useHydrated();
  return (
    <main>
      <h1>Sign in</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const name = new FormData(event.currentTarget).get("name");
          if (typeof name !== "string" || name === "") return;
          await signIn({ data: { name } });
          await router.invalidate();
          router.history.push(redirect ?? "/dashboard");
        }}
      >
        <label>
          Name <input name="name" required />
        </label>
        <button type="submit" disabled={!hydrated}>
          Sign in
        </button>
      </form>
    </main>
  );
}
