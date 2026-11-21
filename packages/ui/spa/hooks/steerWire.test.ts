/**
 * @jest-environment jsdom
 */
import {
  promptContentBlocks,
  routeSteerStatus,
  steerContentBlocks,
} from "./steerWire";
import {
  AIServerMessage,
  AISteerMessage,
  AIWatchSessionMessage,
} from "./useAIWebSocket";

/**
 * The wire side of steering: what the Studio sends (`ai_steer`), what it
 * reads back (`ai_steer_status`), and who a status is for.
 */

const status = (steerId: string, value: string, reason?: string) => ({
  type: "ai_steer_status",
  id: "prompt-1",
  steerId,
  status: value,
  ...(reason !== undefined ? { reason } : {}),
});

describe("ai_steer_status", () => {
  test("every status parses, and so does one this client does not know", () => {
    for (const value of [
      "accepted",
      "delivered",
      "too_late",
      "rejected",
      "something_new",
    ]) {
      expect(AIServerMessage.safeParse(status("s1", value)).success).toBe(true);
    }
  });

  test("relayed to a watcher inside ai_watched, it parses", () => {
    expect(
      AIServerMessage.safeParse({
        type: "ai_watched",
        sessionId: "chat-1",
        event: status("s1", "delivered"),
      }).success,
    ).toBe(true);
  });
});

describe("routeSteerStatus", () => {
  const parse = (message: unknown) => {
    const parsed = AIServerMessage.parse(message);
    if (parsed.type !== "ai_steer_status") throw new Error(parsed.type);
    return parsed;
  };

  test("this chat's own steer goes to the chat, whatever the prompt has done", () => {
    const own = new Set(["s1"]);
    for (const value of ["accepted", "delivered", "too_late", "rejected"]) {
      expect(routeSteerStatus(parse(status("s1", value)), own, false)).toEqual({
        to: "chat",
        status: value,
      });
    }
  });

  test("an unknown status is ignored", () => {
    expect(
      routeSteerStatus(
        parse(status("s1", "something_new")),
        new Set(["s1"]),
        true,
      ),
    ).toEqual({ to: "nobody" });
  });

  test("someone else's goes to the watched chat, and only while watching", () => {
    const message = parse(status("theirs", "delivered"));
    expect(routeSteerStatus(message, new Set(["s1"]), true)).toEqual({
      to: "watched",
    });
    expect(routeSteerStatus(message, new Set(["s1"]), false)).toEqual({
      to: "nobody",
    });
  });
});

describe("ai_steer", () => {
  test("carries the message as a prompt would: text, image keys, and what was picked", () => {
    const blocks = promptContentBlocks(
      [{ tag: "p", children: ["Use this one"] }],
      [{ key: "img-1", name: "photo.png", mimeType: "image/png" }],
      { tag: "h1", text: "Hello", classes: [], selector: "main > h1" },
    );
    const message = AISteerMessage.parse({
      type: "ai_steer",
      id: "prompt-1",
      sessionId: "chat-1",
      steerId: "s1",
      message: blocks,
    });
    expect(message.message[0]).toMatchObject({ type: "text" });
    const [text, image] = Array.isArray(message.message) ? message.message : [];
    expect(text).toMatchObject({ type: "text" });
    if (text?.type !== "text") throw new Error("no text block");
    expect(text.text).toContain("Use this one");
    expect(text.text).toContain('image_key="img-1"');
    expect(text.text).toContain("Hello");
    expect(image).toEqual({ type: "image_key", key: "img-1" });
  });
});

describe("the final server's details", () => {
  test("a watch asks for steer statuses", () => {
    expect(
      AIWatchSessionMessage.parse({
        type: "ai_watch_session",
        sessionId: "chat-1",
        steering: true,
      }).steering,
    ).toBe(true);
  });

  test("delivered may carry what was sent", () => {
    const parsed = AIServerMessage.parse({
      ...status("s1", "delivered"),
      message: [{ type: "text", text: "Only the blog posts" }],
    });
    expect(parsed).toMatchObject({ message: [{ type: "text" }] });
  });

  test("a steer's text is trimmed, a blank text block is dropped, and nothing left is nothing sent", () => {
    expect(
      steerContentBlocks([{ type: "text", text: "  Only the posts \n" }]),
    ).toEqual([{ type: "text", text: "Only the posts" }]);
    expect(
      steerContentBlocks([
        { type: "text", text: "   " },
        { type: "image_key", key: "img-1" },
      ]),
    ).toEqual([{ type: "image_key", key: "img-1" }]);
    expect(steerContentBlocks([{ type: "text", text: " \n " }])).toBeNull();
  });
});
