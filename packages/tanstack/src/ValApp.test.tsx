/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { initVal } from "@valbuild/core";
import { VAL_APP_ID } from "@valbuild/ui";
import { ValApp } from "./ValApp";

// Injecting the Studio's script is not what this is about, and jsdom has no
// `CSS.escape` for `ValScript` to build its selector with.
jest.mock("./ValScript", () => ({ ValScript: () => null }));

/**
 * The Studio's loading screen has to stay up until the Studio can be seen.
 *
 * It used to be rendered instead of the Studio and dropped as soon as the page
 * hydrated -- before the Studio's script was even requested -- so opening the
 * Studio was a spinner, then an empty page for as long as the Studio took to
 * download, then the Studio. The empty page is what read as a flash.
 */
describe("ValApp's loading screen", () => {
  const { config } = initVal({ project: "acme/site", defaultTheme: "dark" });
  const spinner = () => document.querySelector("svg path");

  test("is up from the first render, and the Studio starts loading under it", () => {
    render(<ValApp config={config} />);
    expect(spinner()).not.toBeNull();
    expect(document.getElementById(VAL_APP_ID)).not.toBeNull();
  });

  test("stays up after the page has hydrated, until the Studio's styles have loaded", () => {
    render(<ValApp config={config} />);
    expect(spinner()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent("val-css-loaded"));
    });
    expect(spinner()).toBeNull();
    expect(document.getElementById(VAL_APP_ID)).not.toBeNull();
  });

  test("covers the page rather than taking its place", () => {
    render(<ValApp config={config} />);
    const screen = spinner()?.closest("div");
    expect(screen?.style.position).toBe("fixed");
  });
});
