/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { CanvasRouteBar } from "./CanvasRouteBar";

const ROUTES = [
  "/",
  "/blogs/blog1",
  "/blogs/blog-2",
  "/blogs/blog-3",
  "/blogs/blog-4",
  "/blogs/blog-32",
];

function setup(value = "/") {
  const onChange = jest.fn();
  render(<CanvasRouteBar value={value} routes={ROUTES} onChange={onChange} />);
  return { onChange };
}

describe("CanvasRouteBar", () => {
  test("clicking a suggestion commits that suggestion", () => {
    const { onChange } = setup();
    fireEvent.focus(screen.getByLabelText("Canvas route"));
    const option = screen.getByRole("option", { name: "/blogs/blog-4" });
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith("/blogs/blog-4");
  });

  test("Enter commits what was typed, not the first match", () => {
    const { onChange } = setup();
    const input = screen.getByLabelText("Canvas route");
    fireEvent.change(input, { target: { value: "/blogs/blog-32" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("/blogs/blog-32");
  });

  test("Enter commits a typed prefix, not a longer route matching it", () => {
    const { onChange } = setup();
    const input = screen.getByLabelText("Canvas route");
    fireEvent.change(input, { target: { value: "/blogs/blog-3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("/blogs/blog-3");
  });

  test("arrow keys then Enter commits the highlighted suggestion", () => {
    const { onChange } = setup();
    const input = screen.getByLabelText("Canvas route");
    fireEvent.change(input, { target: { value: "blog-3" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    // Second of the two matches: blog-3, blog-32.
    expect(onChange).toHaveBeenCalledWith("/blogs/blog-32");
  });

  /**
   * The highlighted option is the one Enter takes, so which one it is matters
   * more than the order the list happens to be in.
   */
  test("an exact match is offered first, whatever order the routes are in", () => {
    const onChange = jest.fn();
    render(
      <CanvasRouteBar
        value="/"
        // Deliberately the wrong way round: the longer route first.
        routes={["/blogs/blog-32", "/blogs/blog-3"]}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Canvas route");
    fireEvent.change(input, { target: { value: "/blogs/blog-3" } });
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toBe("/blogs/blog-3");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("/blogs/blog-3");
  });

  test("a route that only contains the query comes after one that starts with it", () => {
    const onChange = jest.fn();
    render(
      <CanvasRouteBar
        value="/"
        routes={["/archive/blogs/old", "/blogs/new"]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Canvas route"), {
      target: { value: "/blogs" },
    });
    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toBe("/blogs/new");
  });
});
