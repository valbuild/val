/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FontSpecimen } from "./FontPreview";

/**
 * jsdom has no `FontFace` and no `document.fonts`, so both are stood in for:
 * the claim here is what the specimen does with a font that loads and with one
 * that does not, not that a browser can parse a WOFF2.
 */
describe("FontSpecimen", () => {
  const added: { family: string; source: string }[] = [];
  let fail = false;

  beforeEach(() => {
    added.length = 0;
    fail = false;
    class FakeFontFace {
      constructor(
        public family: string,
        public source: string,
      ) {}
      load() {
        return fail
          ? Promise.reject(new Error("bad font"))
          : Promise.resolve(this);
      }
    }
    Object.assign(globalThis, { FontFace: FakeFontFace });
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        add: (face: { family: string; source: string }) => added.push(face),
      },
    });
  });

  test("sets the specimen in the loaded face", async () => {
    await act(async () => {
      render(
        <FontSpecimen url="/val/fonts/inter_a1b2c.woff2" variant="tile" />,
      );
    });
    const aa = screen.getByText("Aa");
    expect(added).toHaveLength(1);
    expect(added[0].source).toBe('url("/val/fonts/inter_a1b2c.woff2")');
    expect(aa.style.fontFamily).toContain(added[0].family);
  });

  test("loads one URL once, however many tiles show it", async () => {
    await act(async () => {
      render(
        <>
          <FontSpecimen url="/val/fonts/once_a1b2c.woff2" variant="tile" />
          <FontSpecimen url="/val/fonts/once_a1b2c.woff2" variant="tile" />
        </>,
      );
    });
    expect(screen.getAllByText("Aa")).toHaveLength(2);
    expect(added).toHaveLength(1);
  });

  test("a font that cannot be loaded is a file icon, not a blank box", async () => {
    fail = true;
    await act(async () => {
      render(
        <FontSpecimen
          url="/val/fonts/broken_a1b2c.woff2"
          variant="inspector"
        />,
      );
    });
    expect(screen.queryByText("Aa Gg")).toBeNull();
    expect(screen.getByTitle("Could not load the font")).toBeTruthy();
  });

  test("the inspector previews what is typed", async () => {
    await act(async () => {
      render(
        <FontSpecimen url="/val/fonts/typed_a1b2c.woff2" variant="inspector" />,
      );
    });
    expect(
      screen.getAllByText("The quick brown fox jumps over the lazy dog"),
    ).toHaveLength(3);
    const input = screen.getByLabelText("Preview text");
    fireEvent.change(input, { target: { value: "Blank AS" } });
    expect(screen.getAllByText("Blank AS")).toHaveLength(3);
  });
});
