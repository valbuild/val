/** @jest-environment jsdom */
import {
  attachElementPicker,
  describeElement,
  startElementPicking,
} from "./elementPicker";

function page(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("describeElement", () => {
  test("names any element by its tag, its words and where it is", () => {
    const root = page(
      `<section><p>Intro</p></section><section class="bg-subtle px-8"><h2 class="text-2xl">Worn for   years,
       not weeks</h2></section>`,
    );
    const heading = root.querySelector("h2")!;
    expect(describeElement(heading, root)).toEqual({
      tag: "h2",
      text: "Worn for years, not weeks",
      classes: ["text-2xl"],
      selector: "section:nth-of-type(2) > h2",
    });
  });

  test("an id ends the selector, since it is unique already", () => {
    const root = page(`<main id="top"><div><a>Shop</a></div></main>`);
    expect(describeElement(root.querySelector("a")!, root).selector).toBe(
      "main#top > div > a",
    );
  });

  test("carries the Val field it is inside of, when there is one", () => {
    const root = page(
      `<figure data-val-path='/app/page.val.ts?p="hero"'><span>Hi</span></figure>`,
    );
    expect(describeElement(root.querySelector("span")!, root).valPath).toBe(
      '/app/page.val.ts?p="hero"',
    );
  });

  test("shortens long text", () => {
    const root = page(`<p>${"word ".repeat(40)}</p>`);
    const text = describeElement(root.querySelector("p")!, root).text;
    expect(text.length).toBe(80);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("attachElementPicker", () => {
  const click = (element: Element, init: MouseEventInit = {}) =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
    );

  test("picks only while the modifier is held, and the page never sees that click", () => {
    const root = page(`<a href="#x">Shop</a>`);
    const link = root.querySelector("a")!;
    const picked: Element[] = [];
    const pageClicks: Event[] = [];
    link.addEventListener("click", (event) => pageClicks.push(event));
    const detach = attachElementPicker(root, {
      modifier: "alt",
      active: () => false,
      onHover: () => {},
      onPick: (element) => picked.push(element),
    });

    expect(click(link)).toBe(true);
    expect(picked).toEqual([]);
    expect(pageClicks).toHaveLength(1);

    expect(click(link, { altKey: true })).toBe(false);
    expect(picked).toEqual([link]);
    expect(pageClicks).toHaveLength(1);

    detach();
    click(link, { altKey: true });
    expect(picked).toHaveLength(1);
  });

  test("Select turns it on without the modifier", () => {
    const root = page(`<button>Book a fitting</button>`);
    const picked: Element[] = [];
    attachElementPicker(root, {
      modifier: "alt",
      active: () => true,
      onHover: () => {},
      onPick: (element) => picked.push(element),
    });
    click(root.querySelector("button")!);
    expect(picked).toHaveLength(1);
  });

  test("outlines what is under the pointer only while picking", () => {
    const root = page(`<h1>Clothes</h1>`);
    const heading = root.querySelector("h1")!;
    const hovered: (Element | null)[] = [];
    attachElementPicker(root, {
      modifier: "alt",
      active: () => false,
      onHover: (element) => hovered.push(element),
      onPick: () => {},
    });
    heading.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    heading.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, altKey: true }),
    );
    expect(hovered).toEqual([null, heading]);
  });
});

describe("startElementPicking", () => {
  const altClick = (element: Element) =>
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        altKey: true,
      }),
    );
  const boxes = () =>
    document.querySelector("[data-val-picker]")?.shadowRoot ?? null;

  test("outlines and names what is under the pointer, and keeps the pick outlined", () => {
    const root = page(`<section><h2 class="mb-6 text-2xl">Worn</h2></section>`);
    const heading = root.querySelector("h2")!;
    const picked: unknown[] = [];
    const picking = startElementPicking(root, {
      modifier: "alt",
      active: () => false,
      color: "#079455",
      onPick: (element) => picked.push(element),
      onStop: () => {},
    });
    const shadow = boxes();
    expect(shadow).not.toBeNull();
    const hover = shadow!.querySelector<HTMLElement>('[data-kind="hover"]')!;
    const kept = shadow!.querySelector<HTMLElement>('[data-kind="picked"]')!;

    heading.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, altKey: true }),
    );
    expect(hover.style.display).toBe("block");
    expect(hover.textContent).toBe("h2.mb-6.text-2xl");
    expect(document.documentElement.hasAttribute("data-val-picking")).toBe(
      true,
    );

    altClick(heading);
    expect(picked).toEqual([
      expect.objectContaining({ tag: "h2", text: "Worn" }),
    ]);
    expect(hover.style.display).toBe("none");
    expect(kept.style.display).toBe("block");

    picking.clearPicked();
    expect(kept.style.display).toBe("none");

    picking.stop();
    expect(boxes()).toBeNull();
    expect(document.documentElement.hasAttribute("data-val-picking")).toBe(
      false,
    );
  });

  test("Esc stops Select, and only while it is on", () => {
    const root = page(`<p>Hi</p>`);
    let active = false;
    let stops = 0;
    const picking = startElementPicking(root, {
      modifier: "alt",
      active: () => active,
      color: "#079455",
      onPick: () => {},
      onStop: () => stops++,
    });
    const esc = () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    esc();
    active = true;
    esc();
    expect(stops).toBe(1);
    picking.stop();
  });
});
