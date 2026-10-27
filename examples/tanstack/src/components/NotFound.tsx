import { Link } from "@tanstack/react-router";

/**
 * The app's 404.
 *
 * Wired up as the router's `defaultNotFoundComponent`. With Val this is a
 * page an editor can reach by accident — a route whose key has not been
 * created yet, or one they have just deleted — so it should look like part of
 * the site rather than like a crash.
 */
export function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p>
        There is no page here yet. If you are editing in Val Studio, this route
        may not have a content entry — add one under <strong>Pages</strong>.
      </p>
      <p>
        <Link to="/">Back to the home page</Link>
      </p>
    </main>
  );
}
