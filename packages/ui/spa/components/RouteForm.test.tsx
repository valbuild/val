/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { parseRoutePattern } from "@valbuild/shared/internal";
import { RouteForm } from "./RouteForm";

/**
 * A rename form keeps what was typed when its props are rebuilt.
 *
 * `routePattern` is an ARRAY prop, and the effect that seeds the form from
 * `defaultValue` lists it as a dependency. The array's identity belongs to the
 * sitemap - `collectNewPageRoutes` copies `item.routePattern` by reference - so
 * anything that rebuilds the sitemap hands this component an equal-but-new
 * array and re-runs that effect, throwing away what the editor typed.
 *
 * The consequence is not just a cleared input: `RouteForm` disables its submit
 * while `fullPath === defaultValue`, so a reset puts the form back to "the URL
 * it already has" and the button goes disabled and STAYS disabled. That is what
 * `e2e/page-rename.spec.ts:52` hit - the Rename button resolving and then never
 * becoming clickable for the full 90s timeout.
 *
 * The test creates a page immediately before renaming it, which writes a patch,
 * which rebuilds the sitemap - so the window is wide open there. An editor
 * renaming a page while anything else lands hits the same thing.
 */
const PATTERN = "/blogs/[blog]";

/** Plain DOM reads: this repo does not register jest-dom matchers. */
function submit(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement;
}
function blogInput(): HTMLInputElement {
  return screen.getByPlaceholderText("blog") as HTMLInputElement;
}

function renderForm(routePattern = parseRoutePattern(PATTERN)) {
  return render(
    <RouteForm
      routePattern={routePattern}
      existingKeys={["/blogs/rename-me"]}
      defaultValue="/blogs/rename-me"
      submitText="Rename"
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
}

describe("RouteForm", () => {
  it("enables its submit once the key differs from the current one", () => {
    renderForm();
    expect(submit().disabled).toBe(true);
    fireEvent.change(blogInput(), { target: { value: "renamed" } });
    expect(submit().disabled).toBe(false);
  });

  it("keeps what was typed when the pattern is rebuilt, and stays submittable", () => {
    const { rerender } = renderForm();
    fireEvent.change(blogInput(), { target: { value: "renamed" } });
    expect(submit().disabled).toBe(false);

    // A new array, equal to the old one: exactly what a sitemap rebuild hands
    // down. Nothing about the route changed, so nothing about the form should.
    rerender(
      <RouteForm
        routePattern={parseRoutePattern(PATTERN)}
        existingKeys={["/blogs/rename-me"]}
        defaultValue="/blogs/rename-me"
        submitText="Rename"
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(blogInput().value).toBe("renamed");
    expect(submit().disabled).toBe(false);
  });
});
