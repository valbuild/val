/** @jest-environment jsdom */
import { render } from "@testing-library/react";
import { SketchpadEditor, defaultMediaUrl } from "./SketchpadEditor";

/**
 * What a box's image is loaded from.
 *
 * The assistant fills a sketch from the page it is about, and copies an
 * image's content path as it is: `/public/val/hero.webp`. The site serves
 * that file at `/val/hero.webp`, so a box that handed the path straight to
 * `<img src>` showed a broken image for every picture the page already had.
 */
describe("a box's image", () => {
  test.each([
    ["/public/val/images/hero.webp", "/val/images/hero.webp"],
    ["https://cdn.example/a.jpg", "https://cdn.example/a.jpg"],
    ["/storybook-media/poster.webp", "/storybook-media/poster.webp"],
  ])("%s is loaded from %s", (src, url) => {
    expect(defaultMediaUrl(src)).toBe(url);
  });

  const imgOf = (container: HTMLElement) => container.querySelector("img");

  test("a content path is shown where the site serves it", () => {
    const { container } = render(
      <SketchpadEditor
        value={"[hero: The team](image: /public/val/team.jpg)\n"}
        attach={null}
      />,
    );
    expect(imgOf(container)?.getAttribute("src")).toBe("/val/team.jpg");
  });

  test("the text keeps the path the assistant wrote", () => {
    const onChange = jest.fn();
    render(
      <SketchpadEditor
        value={"[hero](image: /public/val/team.jpg)\n"}
        attach={null}
        onChange={onChange}
      />,
    );
    // Nothing was edited, so nothing is written back over the path.
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an unpublished upload is loaded through the Studio's own URL", () => {
    const studioUrl = (src: string) => `/api/val/files${src}?patch_id=p1`;
    const { container, rerender } = render(
      <SketchpadEditor
        value={"[hero](image: /public/val/team.jpg)\n"}
        attach={null}
      />,
    );
    rerender(
      <SketchpadEditor
        value={"[hero](image: /public/val/team.jpg)\n"}
        attach={null}
        mediaUrl={studioUrl}
      />,
    );
    // A new mediaUrl redraws the boxes: the upload was published, or made.
    expect(imgOf(container)?.getAttribute("src")).toBe(
      "/api/val/files/public/val/team.jpg?patch_id=p1",
    );
  });
});
