/**
 * @jest-environment jsdom
 */
import { QUICK_PREVIEW_RENDER_SCRIPT } from "./quickPreview";

/**
 * What a quick preview's document runs before the app's scripts. A page that
 * React hydrates keeps the attributes the server rendered: a quick preview of
 * a change to classes -- a layout -- hydrated into the last build's markup
 * and showed nothing, while a change to text showed. With the markup gone,
 * React has nothing to hydrate and renders the page from the new code.
 */
test("takes the server's markup out of the body, and leaves its scripts", () => {
  document.body.innerHTML =
    '<main class="flex flex-col gap-8"><a>One</a><a>Two</a></main>' +
    "<script>window.$_TSR = {}</script>text";
  new Function(
    QUICK_PREVIEW_RENDER_SCRIPT.replace(/^<script>|<\/script>$/g, ""),
  )();
  expect(document.body.innerHTML).toBe("<script>window.$_TSR = {}</script>");
});
