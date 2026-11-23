import { thinkingTail } from "./aiThinking";
import { toolCallDetail } from "./aiToolCallWriting";

describe("thinkingTail", () => {
  test("the last line that says something, on one line", () => {
    expect(thinkingTail("")).toBe("");
    expect(thinkingTail("Reading the hero.\n\nNow the  title\n \n")).toBe(
      "Now the title",
    );
  });

  test("a long line shows its end", () => {
    const tail = thinkingTail(`${"a".repeat(300)} the end`);
    expect(tail.startsWith("…")).toBe(true);
    expect(tail.endsWith("the end")).toBe(true);
    expect(tail.length).toBe(141);
  });
});

describe("toolCallDetail", () => {
  test("a path, or the files of a write", () => {
    expect(toolCallDetail({})).toBeUndefined();
    expect(toolCallDetail({ arguments: { path: "src/a.tsx" } })).toBe(
      "src/a.tsx",
    );
    expect(toolCallDetail({ keys: { files: ["src/a.tsx"] } })).toBe(
      "src/a.tsx",
    );
    expect(
      toolCallDetail({ keys: { files: ["src/a.tsx", "b.ts", "c.ts"] } }),
    ).toBe("src/a.tsx and 2 more");
  });
});
