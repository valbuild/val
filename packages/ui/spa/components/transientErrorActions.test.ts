import { namedAction } from "./transientErrorActions";

/**
 * `retry-save` is the button beside "Cannot publish: your latest changes
 * could not be saved" when the content service failed to take them: it sends
 * the held save again, the same as Try again in the status bar.
 */
describe("the retry-save action", () => {
  test("sends the save again", () => {
    const retrySave = jest.fn();
    const action = namedAction("retry-save", { retrySave });
    expect(action?.label).toBe("Save again");
    action?.onClick();
    expect(retrySave).toHaveBeenCalledTimes(1);
  });

  test("is not offered where nothing can send it", () => {
    expect(namedAction("retry-save")).toBeUndefined();
  });
});
