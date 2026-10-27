/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { StudioMark } from "./ValLogo";
import { toShellLogo } from "./shellDataMapping";

/**
 * Whose mark the Studio shows, and what it is called.
 *
 * Two slots use this — the top of the left rail, and beside the menu button
 * below the desktop breakpoint — and both sit inside a navigation landmark,
 * which is what makes the naming worth a test rather than a look: an unnamed
 * image in a `<nav>` is announced with its URL, and a logo's URL is a hash.
 */
describe("StudioMark", () => {
  test("Val's mark when the project has not set one", () => {
    cleanup();
    render(<StudioMark />);
    expect(screen.queryByRole("img", { name: "Val" })).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  test("the project's mark when it has", () => {
    cleanup();
    render(<StudioMark logo={{ url: "/logo.png", alt: "Nordic Retail" }} />);
    const img = screen.queryByRole("img", { name: "Nordic Retail" });
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/logo.png");
    // Val's own mark is gone rather than drawn behind it.
    expect(screen.queryByRole("img", { name: "Val" })).toBeNull();
  });

  test("contained, never cropped", () => {
    // The slot is 32px wide, so a wordmark does not fit. It is made small
    // rather than cut off: a logo with its ends missing reads as a bug in Val,
    // where a small one reads as a picture that did not fit.
    cleanup();
    render(<StudioMark logo={{ url: "/wide.png", alt: "Nordic" }} />);
    expect(document.querySelector("img")?.className).toContain(
      "object-contain",
    );
  });

  test("an unnamed logo is decorative rather than named after its URL", () => {
    // `alt=""` and not a missing attribute: a missing one leaves a screen
    // reader to announce the file name, and `/public/val/brand/mark_a1b2c.png`
    // is not what this picture is.
    cleanup();
    render(<StudioMark logo={{ url: "/logo.png" }} />);
    expect(document.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  test("only Val's mark blinks", () => {
    // The blink is a terminal caret waiting, drawn in SMIL inside the SVG. An
    // `<img>` cannot do it, so a project with a logo shows Val's mark blinking
    // while the Studio loads and its own once the settings arrive.
    cleanup();
    render(<StudioMark blinking />);
    expect(document.querySelector("animate")).not.toBeNull();
    cleanup();
    render(<StudioMark logo={{ url: "/logo.png" }} blinking />);
    expect(document.querySelector("animate")).toBeNull();
  });
});

/**
 * Turning `theme.logo` into what the shell draws.
 *
 * Two rules, and both are about a name: the URL needs the patch id of whatever
 * uploaded it, and the picture needs something to be called.
 */
describe("toShellLogo", () => {
  const noPatches = new Map<string, string>();

  test("no logo, no entry", () => {
    expect(toShellLogo(null, noPatches, "acme/site")).toBeUndefined();
  });

  test("a published logo is served from /public", () => {
    expect(
      toShellLogo(
        { path: "/public/val/brand/mark_a1b2c.png", alt: null },
        noPatches,
        "acme/site",
      ),
    ).toEqual({ url: "/val/brand/mark_a1b2c.png", alt: "acme/site" });
  });

  test("a just-uploaded logo is served with its patch id", () => {
    // The rule `getMediaFileUrl` exists for, and the one that makes a fresh
    // upload render as a broken image when it is got wrong: the bytes are not
    // in `/public` yet, they are in the patch.
    const url = toShellLogo(
      { path: "/public/val/brand/mark_a1b2c.png", alt: null },
      new Map([["/public/val/brand/mark_a1b2c.png", "patch-1"]]),
      "acme/site",
    )?.url;
    expect(url).toContain("/api/val/files");
    expect(url).toContain("patch_id=patch-1");
  });

  test("the image's own alt text wins", () => {
    expect(
      toShellLogo(
        { path: "/public/val/brand/mark.png", alt: "The Acme mark" },
        noPatches,
        "acme/site",
      )?.alt,
    ).toBe("The Acme mark");
  });

  test("with no alt text it is named after the project", () => {
    // A mark at the top of the rail IS the project's name in picture form, so
    // "acme/site" is the right thing to announce. `alt` is authored and
    // usually is not.
    expect(
      toShellLogo(
        { path: "/public/val/brand/mark.png", alt: null },
        noPatches,
        "acme/site",
      )?.alt,
    ).toBe("acme/site");
  });

  test("no alt and no project name leaves it decorative", () => {
    expect(
      toShellLogo(
        { path: "/public/val/brand/mark.png", alt: null },
        noPatches,
        undefined,
      ),
    ).toEqual({ url: "/val/brand/mark.png" });
  });
});
