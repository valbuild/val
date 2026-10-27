/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

/**
 * The two states a name can be in, which are not the same state.
 *
 * `null` is "there is nobody here" — an author-less change — and takes the
 * fallback glyph. An empty string is a profile that loaded WITHOUT a name,
 * which is still a person: it gets initials. Treating both as falsy left the
 * second one as an empty circle with an empty `aria-label` on it.
 */
describe("Avatar", () => {
  test("takes initials from a name", () => {
    render(<Avatar name="Fredrik Ekholdt" />);
    expect(screen.getByRole("img", { name: "Fredrik Ekholdt" })).not.toBeNull();
    expect(screen.getByText("FE")).not.toBeNull();
  });

  test("draws the fallback when there is nobody", () => {
    render(
      <Avatar name={null} label="Local changes" fallback={<span>·</span>} />,
    );
    expect(screen.getByRole("img", { name: "Local changes" })).not.toBeNull();
  });

  test("still draws something for a profile with no name", () => {
    render(<Avatar name="" />);
    expect(screen.getByText("?")).not.toBeNull();
  });

  // An `img` role with an empty name is worse than no role: without one the
  // "?" is read as the ordinary text it is.
  test("does not claim to be a named image when it has no name", () => {
    render(<Avatar name="" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("renders the picture over the initials, so both are there", () => {
    render(
      <Avatar name="Ada Lovelace" imageUrl="https://example.test/a.png" />,
    );
    expect(screen.getByText("AL")).not.toBeNull();
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://example.test/a.png");
    // The wrapper carries the name; the image must not repeat it.
    expect(img?.getAttribute("alt")).toBe("");
  });
});
