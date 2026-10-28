/**
 * @jest-environment jsdom
 */
import {
  findBySelector,
  pageLocationOf,
  readPageSnapshot,
  watchPageLocation,
} from "./pageInspection";
import { describeElement } from "./elementPicker";

beforeEach(() => {
  document.title = "Our people";
  document.body.innerHTML = `
    <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
    <main>
      <section>
        <h1>Our people</h1>
        <p>We are <strong>twelve</strong> people in Oslo.</p>
        <img src="/team.jpg" alt="The team on a roof" />
        <button>Join us</button>
      </section>
      <section id="contact">
        <h2>Contact</h2>
        <input name="email" placeholder="Your email" />
        <p hidden>Not shown</p>
        <div style="display: none"><p>Nor this</p></div>
      </section>
    </main>
    <script>console.log("never read")</script>
  `;
});

test("reads the page in order, as a reader takes it in", () => {
  const snapshot = readPageSnapshot(document);
  expect(snapshot.title).toBe("Our people");
  expect(
    snapshot.outline.map((item) => [item.kind, item.text ?? item.alt ?? ""]),
  ).toEqual([
    ["section", ""],
    ["section", ""],
    ["link", "Home"],
    ["link", "About"],
    ["section", ""],
    ["section", ""],
    ["heading", "Our people"],
    ["text", "We are twelve people in Oslo."],
    ["image", "The team on a roof"],
    ["button", "Join us"],
    ["section", ""],
    ["heading", "Contact"],
    ["input", "Your email"],
  ]);
  const heading = snapshot.outline.find((item) => item.kind === "heading");
  expect(heading?.level).toBe(1);
  expect(snapshot.outline.find((item) => item.kind === "link")?.href).toBe("/");
});

test("a selector reads one element in detail, and the outline within it", () => {
  const snapshot = readPageSnapshot(document, {
    selector: "main > section:nth-of-type(1) > h1",
  });
  expect(snapshot.element).toMatchObject({
    tag: "h1",
    text: "Our people",
    selector: "main > section:nth-of-type(1) > h1",
  });
  expect(snapshot.outline.map((item) => item.kind)).toEqual(["heading"]);
});

test("reads the element a picked element's selector names", () => {
  const h2 = document.querySelector("h2");
  if (h2 === null) throw new Error("no h2");
  const picked = describeElement(h2, document.body);
  expect(picked.selector).toBe("section#contact > h2");
  expect(findBySelector(document.body, picked.selector)).toBe(h2);
  const snapshot = readPageSnapshot(document, { selector: picked.selector });
  expect(snapshot.element?.text).toBe("Contact");
});

test("says when a selector names nothing", () => {
  const snapshot = readPageSnapshot(document, { selector: "article > h3" });
  expect(snapshot.notFound).toBe("article > h3");
  expect(snapshot.element).toBeUndefined();
});

test("is cut short, and says so, past maxItems", () => {
  const snapshot = readPageSnapshot(document, { maxItems: 3 });
  expect(snapshot.outline).toHaveLength(3);
  expect(snapshot.truncated).toBe(true);
});

test("where the page is leaves out the canvas's own parameter", () => {
  window.history.replaceState(null, "", "/about?tab=team&val_canvas=1");
  expect(pageLocationOf(window)).toEqual({
    path: "/about?tab=team",
    scrollX: 0,
    scrollY: 0,
  });
});

test("a navigation is reported, once", () => {
  jest.useFakeTimers();
  window.history.replaceState(null, "", "/");
  const seen: string[] = [];
  const stop = watchPageLocation(window, (location) =>
    seen.push(location.path),
  );
  window.history.pushState(null, "", "/blog");
  jest.advanceTimersByTime(600);
  jest.advanceTimersByTime(600);
  stop();
  jest.useRealTimers();
  expect(seen).toEqual(["/", "/blog"]);
});
