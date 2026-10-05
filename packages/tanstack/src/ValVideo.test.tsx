/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { initVal } from "@valbuild/core";
import { stegaEncode, type ResolvedVal } from "@valbuild/react/stega";
import { ValVideo } from "./ValVideo";

const { s, c } = initVal();
const videosVal = c.define(
  "/videos.val.ts",
  s.object({ stream: s.video(), clip: s.video() }),
  {
    stream: {
      path: "/public/val/intro/master.m3u8",
      mimeType: "application/vnd.apple.mpegurl",
    },
    clip: {
      path: "/public/val/intro.mp4",
      mimeType: "video/mp4",
      startTime: 1,
      endTime: 3,
    },
  },
);
// What a reader hands the component. Annotated, because `stegaEncode`
// returns `any`; `disabled` so the URLs carry no edit tags.
const videos: ResolvedVal<typeof videosVal> = stegaEncode(videosVal, {
  disabled: true,
});
const stream = videos.stream;

/**
 * `hls` is documented as passed inline — `hls={() => import("hls.js")}` — so
 * a new function arrives on every render of the parent. Playback must not
 * be torn down and set up again for that.
 */
test("a parent re-render with a new inline loader does not restart the stream", async () => {
  // jsdom plays no HLS itself, so the loader is what attaches the stream.
  HTMLMediaElement.prototype.canPlayType = () => "";
  const created: string[] = [];
  const destroyed: string[] = [];
  class FakeHls {
    static isSupported() {
      return true;
    }
    loadSource(url: string) {
      created.push(url);
    }
    attachMedia() {}
    destroy() {
      destroyed.push("destroyed");
    }
  }
  let rerender = () => {};
  function Parent() {
    const [, setTick] = useState(0);
    rerender = () => setTick((t) => t + 1);
    return (
      <ValVideo
        src={stream}
        hls={() => Promise.resolve({ default: FakeHls })}
      />
    );
  }
  render(<Parent />);
  await act(async () => {});
  await act(async () => {
    rerender();
  });
  await act(async () => {});
  expect(created).toEqual(["/val/intro/master.m3u8"]);
  expect(destroyed).toEqual([]);
});

test("a clip stopped at its end plays again from its start", () => {
  const { container } = render(<ValVideo src={videos.clip} />);
  const video = container.querySelector("video");
  if (!video) throw new Error("no video element");
  video.currentTime = 3;
  video.dispatchEvent(new Event("play"));
  expect(video.currentTime).toBe(1);
});
