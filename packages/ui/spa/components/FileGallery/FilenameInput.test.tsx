/** @jest-environment jsdom */
import "../../stores/react/testPolyfills";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FilenameInput } from "./FilenameInput";

function startRenaming(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Rename file" }));
  const input = screen.getByRole("textbox", { name: "File name" });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("FilenameInput", () => {
  test("locks the hash suffix and the extension", () => {
    render(<FilenameInput filename="hero_a1b2c.png" onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename file" }));
    expect(screen.getByRole("textbox", { name: "File name" })).toHaveProperty(
      "value",
      "hero",
    );
    expect(screen.getByText("_a1b2c.png")).toBeTruthy();
  });

  test("hands over the typed base as typed, dots and all", () => {
    // A file with no extension locks nothing after the hash, so splitting the
    // composed name again would read `.v2` as an extension and drop it.
    const onSave = jest.fn();
    render(<FilenameInput filename="README" onSave={onSave} />);
    startRenaming("release.v2");
    expect(onSave).toHaveBeenCalledWith("release.v2", "release.v2");
  });

  test("keeps a message that comes back with a new name", async () => {
    // A rename that moved the file but could not update every field: the
    // name changes AND there is something to say, and the change must not
    // wipe the message.
    let finish: (message: string | null) => void = () => {};
    const { rerender } = render(
      <FilenameInput
        filename="hero_a1b2c.png"
        onSave={() =>
          new Promise<string | null>((resolve) => {
            finish = resolve;
          })
        }
      />,
    );
    startRenaming("team");
    rerender(
      <FilenameInput filename="team_a1b2c.png" onSave={() => undefined} />,
    );
    await act(async () => {
      finish("Renamed, but /content/page.val.ts could not be updated");
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be updated",
    );
    expect(screen.getByText("team_a1b2c.png")).toBeTruthy();
  });
});
