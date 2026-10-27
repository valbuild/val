/**
 * @jest-environment jsdom
 */
import "./__suspense-test-setup__"; // must come first — polyfills TextEncoder
import React from "react";
import { render, screen } from "@testing-library/react";
import { initVal, Internal } from "@valbuild/core";
import { raw, stegaEncode, type ResolvedVal } from "@valbuild/react/stega";
import { initValClient } from "./initValClient";
import { ValExternalStore, ValOverlayProvider } from "../ValOverlayContext";

/**
 * Reading a route through an `s.view()`.
 *
 * A page that declares which module it shows should be able to READ it the same
 * way — `useValRoute(page.notes, params)` rather than importing the router
 * module a second time. What makes that non-obvious is the failure mode when it
 * does not work: `useValRoute` pulls a path, a schema and a source off its
 * argument, a view pointer has none of the three, and `null` is already what
 * this hook returns for "no such route". So a view argument was never an error
 * — it was a 404, from a call that looks right.
 *
 * `Internal.resolveViewedModule` is the one place that is fixed, shared by the
 * six readers across both framework packages that take a module rather than a
 * value.
 */
const { s, c } = initVal();
const nextAppRouter = Internal.nextAppRouter;

const notesVal = c.define(
  "/app/notes/[note]/page.val.ts",
  s.router(nextAppRouter, s.string(), s.object({ title: s.string() })),
  { "/notes/one": { title: "the note" } },
);

/** The page the editor works on, which points at the router module. */
const pageVal = c.define(
  "/page.val.ts",
  s.object({ title: s.string(), notes: s.view(notesVal) }),
  { title: "Notes", notes: { view: "/app/notes/[note]/page.val.ts" } },
);

const { useValRouteStega, useValRouteUrl } = initValClient({});

/*
 * One component per argument rather than a ternary. A ternary makes the hook's
 * type parameter the UNION of the two, and `RouteValueOf` of a union is not the
 * union of its arms — it collapses to `never`, which would make the test about
 * the conditional's distribution rather than about reading through a view.
 */
function ShowRouteViaView() {
  // Annotated, because `stegaEncode` returns `any` — and an `any` argument
  // would make the hook's type parameter `any` too, so the test would prove
  // nothing about `RouteValueOf`'s view arm.
  const page: ResolvedVal<typeof pageVal> = stegaEncode(pageVal, {});
  const entry = useValRouteStega(page.notes, { note: "one" });
  return React.createElement(
    "span",
    { "data-testid": "val" },
    entry === null ? "notFound" : raw(entry.title),
  );
}

function ShowRouteViaModule() {
  const entry = useValRouteStega(notesVal, { note: "one" });
  return React.createElement(
    "span",
    { "data-testid": "val" },
    entry === null ? "notFound" : raw(entry.title),
  );
}

function ShowUrlViaView() {
  // Annotated, because `stegaEncode` returns `any` — and an `any` argument
  // would make the hook's type parameter `any` too, so the test would prove
  // nothing about `RouteValueOf`'s view arm.
  const page: ResolvedVal<typeof pageVal> = stegaEncode(pageVal, {});
  const url = useValRouteUrl(page.notes, { note: "one" });
  return React.createElement("span", { "data-testid": "val" }, url ?? "none");
}

function tree(children: React.ReactNode) {
  return React.createElement(ValOverlayProvider, {
    store: new ValExternalStore(),
    suspend: false,
    draftMode: false,
    children,
  });
}

const shown = () => screen.queryByTestId("val")?.textContent;

describe("reading a route through a view", () => {
  it("useValRoute resolves the module the view points at", () => {
    render(tree(React.createElement(ShowRouteViaView)));
    expect(shown()).toContain("the note");
  });

  /** The same answer the module itself gives — that is the whole claim. */
  it("gives what passing the module gives", () => {
    const { unmount } = render(tree(React.createElement(ShowRouteViaView)));
    const throughView = shown();
    unmount();
    render(tree(React.createElement(ShowRouteViaModule)));
    expect(throughView).toBe(shown());
  });

  it("useValRouteUrl resolves it too", () => {
    render(tree(React.createElement(ShowUrlViaView)));
    expect(shown()).toBe("/notes/one");
  });
});
