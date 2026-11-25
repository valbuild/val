/**
 * @jest-environment jsdom
 */
import { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { initVal } from "@valbuild/core";
import { stegaEncode, type ResolvedVal } from "@valbuild/react/stega";
import { ValImage, getValImageProps } from "./ValImage";

const REF =
  "https://remote.val.build/file/p/3f9a2c1/b/bucket/v/0.136.2/h/9c41e0b2d7aa/f/3fa9c81be402/p/public/val/hero_3fa9c.jpg";
const PLATFORM_REF =
  "https://www.acme.no/_val/file/p/3f9a2c1/b/r2/v/0.136.2/h/9c41e0b2d7aa/f/3fa9c81be402/p/public/val/photo_3fa9c.png";

const { s, c } = initVal();
const imagesVal = c.define(
  "/images.val.ts",
  s.object({
    remote: s.image().remote(),
    platform: s.image().remote(),
    small: s.image().remote(),
    svg: s.image().remote(),
    local: s.image(),
    draft: s.image().remote(),
  }),
  {
    remote: {
      path: REF,
      width: 4000,
      height: 2000,
      mimeType: "image/jpeg",
      alt: "A hero",
      hotspot: { x: 0.25, y: 0.75 },
    },
    platform: {
      path: PLATFORM_REF,
      width: 3000,
      height: 1500,
      mimeType: "image/png",
    },
    small: {
      path: REF,
      width: 700,
      height: 350,
      mimeType: "image/jpeg",
    },
    svg: {
      path: REF.replace(/jpg$/, "svg"),
      width: 100,
      height: 100,
      mimeType: "image/svg+xml",
    },
    local: {
      path: "/public/val/logo.png",
      width: 100,
      height: 50,
      mimeType: "image/png",
    },
    draft: {
      path: REF,
      width: 4000,
      height: 2000,
      mimeType: "image/jpeg",
      patch_id: "patch-1",
    },
  },
);
// What a reader hands the component. Annotated, because `stegaEncode`
// returns `any`; `disabled` so the URLs carry no edit tags.
const images: ResolvedVal<typeof imagesVal> = stegaEncode(imagesVal, {
  disabled: true,
});
const tagged: ResolvedVal<typeof imagesVal> = stegaEncode(imagesVal, {});

function img(element: React.ReactElement): HTMLImageElement {
  const { container } = render(element);
  const found = container.querySelector("img");
  if (!found) throw new Error("no <img> rendered");
  return found;
}

describe("a remote image is served at the width it is shown", () => {
  test("with `sizes`, every width the host serves that a screen can need", () => {
    const el = img(<ValImage src={images.remote} sizes="100vw" />);
    const srcSet = el.getAttribute("srcset") ?? "";
    // 100vw of the narrowest screen (640) is the smallest that can be needed.
    expect(srcSet.split(", ")).toEqual(
      [640, 750, 828, 1080, 1200, 1600, 1920, 2560, 3840].map(
        (w) => `${REF}?w=${w} ${w}w`,
      ),
    );
    expect(el.getAttribute("sizes")).toBe("100vw");
    expect(el.getAttribute("src")).toBe(`${REF}?w=3840`);
  });

  test("a `vw` in `sizes` leaves out widths too small for any screen", () => {
    const el = img(
      <ValImage src={images.remote} sizes="(min-width: 800px) 50vw, 100vw" />,
    );
    const widths = (el.getAttribute("srcset") ?? "")
      .split(", ")
      .map((entry) => entry.split(" ")[1]);
    // 640 * 0.5 = 320: 384 is the first that can be needed.
    expect(widths[0]).toBe("384w");
  });

  test("no width past the image's own but the first, since a host never scales up", () => {
    const el = img(<ValImage src={images.small} sizes="10vw" />);
    const widths = (el.getAttribute("srcset") ?? "")
      .split(", ")
      .map((entry) => entry.split(" ")[1]);
    // 700 wide: 750 is the first rung past it, and the last one asked for --
    // described as the 700 pixels the host answers it with.
    expect(widths).toEqual(["64w", "128w", "256w", "384w", "640w", "700w"]);
    expect(el.getAttribute("srcset")).toContain(`${REF}?w=750 700w`);
  });

  test("with a fixed width, 1x and 2x it", () => {
    const el = img(<ValImage src={images.remote} width={300} />);
    expect(el.getAttribute("srcset")).toBe(`${REF}?w=384 1x, ${REF}?w=640 2x`);
    expect(el.getAttribute("sizes")).toBeNull();
    expect(el.getAttribute("width")).toBe("300");
    // The other side follows the image's aspect ratio.
    expect(el.getAttribute("height")).toBe("150");
  });

  test("without a width or sizes, the screen widths of the image's own size", () => {
    const el = img(<ValImage src={images.platform} />);
    expect(el.getAttribute("width")).toBe("3000");
    // 3000 is its own width: 1x is 3840 (the first rung past it), and so is 2x.
    expect(el.getAttribute("srcset")).toBe(`${PLATFORM_REF}?w=3840 1x`);
  });

  test("on the platform's host as on remote.val.build", () => {
    const el = img(<ValImage src={images.platform} sizes="50vw" />);
    expect(el.getAttribute("srcset")).toContain(`${PLATFORM_REF}?w=640 640w`);
  });

  test("`quality` is snapped to one the host serves", () => {
    const el = img(<ValImage src={images.remote} width={300} quality={70} />);
    expect(el.getAttribute("srcset")).toBe(
      `${REF}?w=384&q=75 1x, ${REF}?w=640&q=75 2x`,
    );
  });
});

describe("served as it is", () => {
  test("a local image, which TanStack Start has nothing to resize", () => {
    const el = img(<ValImage src={images.local} sizes="100vw" />);
    expect(el.getAttribute("src")).toBe("/val/logo.png");
    expect(el.getAttribute("srcset")).toBeNull();
    expect(el.getAttribute("sizes")).toBeNull();
  });

  test("a draft, whose bytes are in the patch store and at neither host", () => {
    const el = img(<ValImage src={images.draft} sizes="100vw" />);
    expect(el.getAttribute("src")).toMatch(/^\/api\/val\/files\//);
    expect(el.getAttribute("srcset")).toBeNull();
  });

  test("an SVG, and anything with `unoptimized`", () => {
    expect(
      img(<ValImage src={images.svg} sizes="100vw" />).getAttribute("srcset"),
    ).toBeNull();
    const el = img(<ValImage src={images.remote} sizes="100vw" unoptimized />);
    expect(el.getAttribute("srcset")).toBeNull();
    expect(el.getAttribute("src")).toBe(REF);
  });
});

test("a loader of your own is used for every image, local ones included", () => {
  const el = img(
    <ValImage
      src={images.local}
      width={40}
      quality={60}
      loader={({ src, width, quality }) =>
        `https://cdn.example.com${src}?width=${width}&q=${quality}`
      }
    />,
  );
  expect(el.getAttribute("srcset")).toBe(
    "https://cdn.example.com/val/logo.png?width=64&q=60 1x, https://cdn.example.com/val/logo.png?width=128&q=60 2x",
  );
});

test("`fill` positions the image at its parent's edges and takes the viewport as its width", () => {
  const el = img(<ValImage src={images.remote} fill />);
  expect(el.getAttribute("width")).toBeNull();
  expect(el.getAttribute("height")).toBeNull();
  expect(el.style.position).toBe("absolute");
  expect(el.style.width).toBe("100%");
  expect(el.getAttribute("sizes")).toBe("100vw");
  // The hotspot is still where the image is cropped around.
  expect(el.style.objectPosition).toBe("25% 75%");
});

test("lazy and async by default, as next/image is", () => {
  const el = img(<ValImage src={images.remote} />);
  expect(el.getAttribute("loading")).toBe("lazy");
  expect(el.getAttribute("decoding")).toBe("async");
});

test("`priority` loads eagerly, first, and is preloaded from the head", () => {
  const html = renderToString(
    <html>
      <head />
      <body>
        <ValImage src={images.remote} sizes="100vw" priority />
      </body>
    </html>,
  );
  expect(html).toMatch(/<link rel="preload"[^>]*as="image"/);
  expect(html).toMatch(/imageSrcSet="[^"]*\?w=640 640w/);
  expect(html).toMatch(/<img[^>]*loading="eager"/);
  expect(html).toMatch(/<img[^>]*fetchPriority="high"/);
});

describe("placeholder", () => {
  test("`blur` without a data URL shows the smallest copy until the image has loaded", () => {
    const el = img(
      <ValImage src={images.remote} sizes="100vw" placeholder="blur" />,
    );
    expect(el.style.backgroundImage).toBe(`url("${REF}?w=64")`);
    expect(el.style.backgroundPosition).toBe("25% 75%");
    act(() => {
      fireEvent.load(el);
    });
    expect(el.style.backgroundImage).toBe("");
  });

  /**
   * The SVG the placeholder is drawn with, as the browser reads it: the
   * outer data URL decoded once, then parsed as XML. Read from the server's
   * HTML, because jsdom's CSS parser drops a `url()` this long.
   */
  function placeholderSvg(element: React.ReactElement): Document {
    const container = document.createElement("div");
    container.innerHTML = renderToString(element);
    const style = container.querySelector("img")?.getAttribute("style") ?? "";
    const match = /url\("data:image\/svg\+xml;charset=utf-8,(.*?)"\)/.exec(
      style,
    );
    if (!match) throw new Error(`no blurred placeholder in: ${style}`);
    return new DOMParser().parseFromString(
      decodeURIComponent(match[1]),
      "image/svg+xml",
    );
  }

  test("`blur` with a data URL blurs it", () => {
    const svg = placeholderSvg(
      <ValImage
        src={images.local}
        placeholder="blur"
        blurDataURL="data:image/png;base64,AAAA"
      />,
    );
    expect(svg.querySelector("feGaussianBlur")).not.toBeNull();
    expect(svg.querySelector("image")?.getAttribute("href")).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  test("a percent-encoded SVG `blurDataURL` survives being nested in the blur", () => {
    const blurDataURL = `data:image/svg+xml,${encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'><rect fill=\"#c33\" width='1' height='1'/></svg>",
    )}`;
    const svg = placeholderSvg(
      <ValImage
        src={images.local}
        placeholder="blur"
        blurDataURL={blurDataURL}
      />,
    );
    expect(svg.querySelector("parsererror")).toBeNull();
    expect(svg.querySelector("image")?.getAttribute("href")).toBe(blurDataURL);
  });

  test("a data URL given as the placeholder is shown as it is, not blurred", () => {
    const html = renderToString(
      <ValImage src={images.local} placeholder="data:image/png;base64,AAAA" />,
    );
    expect(html).toContain(
      "background-image:url(&quot;data:image/png;base64,AAAA&quot;)",
    );
    expect(html).not.toContain("feGaussianBlur");
  });

  test("the caller's `onLoad` is still called", () => {
    const onLoad = jest.fn();
    const el = img(
      <ValImage src={images.remote} placeholder="blur" onLoad={onLoad} />,
    );
    act(() => {
      fireEvent.load(el);
    });
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  test("the caller's ref is still set", () => {
    const ref = createRef<HTMLImageElement>();
    render(<ValImage src={images.remote} placeholder="blur" ref={ref} />);
    expect(ref.current?.tagName).toBe("IMG");
  });
});

test("the edit tags are attributes, never in the URLs the browser asks for", () => {
  const el = img(<ValImage src={tagged.remote} sizes="100vw" />);
  expect(el.getAttribute("data-val-path")).toBe('/images.val.ts?p="remote"');
  expect(el.getAttribute("src")).toBe(`${REF}?w=3840`);
  expect(el.getAttribute("srcset")).toContain(`${REF}?w=640 640w`);
  expect(el.getAttribute("alt")).toBe("A hero");
});

test("getValImageProps gives the attributes for a <picture>", () => {
  const { props } = getValImageProps({ src: images.remote, sizes: "100vw" });
  expect(props.srcSet).toContain(`${REF}?w=640 640w`);
  expect(props.sizes).toBe("100vw");
  expect(props.width).toBe(4000);
  expect(props.height).toBe(2000);
});
