import { mediaLink } from "./boxNodeView";

describe("the links a box takes", () => {
  test.each([
    [
      "https://example.com/a.jpg",
      { type: "image", src: "https://example.com/a.jpg" },
    ],
    ["  /images/hero.webp ", { type: "image", src: "/images/hero.webp" }],
    [
      "https://cdn.example/clip.MP4?v=2",
      { type: "video", src: "https://cdn.example/clip.MP4?v=2" },
    ],
    ["/val/stream.m3u8", { type: "video", src: "/val/stream.m3u8" }],
  ])("%j", (value, media) => {
    expect(mediaLink(value)).toEqual(media);
  });

  // Saved and read elsewhere, so nothing that lives only in this tab.
  test.each([
    "",
    "blob:http://localhost:5173/0f3a",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "//evil.example/a.jpg",
    "photo.jpg",
  ])("not %j", (value) => {
    expect(mediaLink(value)).toBeNull();
  });
});
