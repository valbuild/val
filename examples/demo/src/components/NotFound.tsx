import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="page">
      <h1>Not found</h1>
      <p>
        There is no page here yet. In the Studio, add one under{" "}
        <strong>Pages</strong>.
      </p>
      <p>
        <Link to="/">Back to the home page</Link>
      </p>
    </main>
  );
}
