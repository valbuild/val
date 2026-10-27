import path from "path";
import { filesOfVideo } from "./videoFiles";

describe("filesOfVideo", () => {
  const projectRoot = "/project";

  test("a progressive video: the file, its poster and each caption track", () => {
    expect(
      filesOfVideo(
        {
          path: "/public/val/intro_abc12.mp4",
          mimeType: "video/mp4",
          poster: { path: "/public/val/intro-poster_def34.jpg" },
          captions: [
            { path: "/public/val/intro.en_aaaaa.vtt", srclang: "en" },
            { path: "/public/val/intro.nb_bbbbb.vtt", srclang: "nb" },
          ],
        },
        { projectRoot, readFile: () => undefined },
      ),
    ).toEqual([
      "/public/val/intro_abc12.mp4",
      "/public/val/intro-poster_def34.jpg",
      "/public/val/intro.en_aaaaa.vtt",
      "/public/val/intro.nb_bbbbb.vtt",
    ]);
  });

  test("a local HLS stream: everything its playlists name, and nothing else in the directory", () => {
    const dir = "/public/val/clip_abc12";
    const files: Record<string, string> = {
      [`${dir}/master.m3u8`]: [
        "#EXTM3U",
        '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="a",URI="audio.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720,AUDIO="aud"',
        "720p.m3u8",
        '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=854x480,AUDIO="aud"',
        "480p.m3u8",
      ].join("\n"),
      [`${dir}/720p.m3u8`]:
        '#EXTM3U\n#EXT-X-MAP:URI="720p.mp4",BYTERANGE="800@0"\n#EXTINF:6,\n#EXT-X-BYTERANGE:100@800\n720p.mp4\n',
      [`${dir}/480p.m3u8`]:
        '#EXTM3U\n#EXT-X-MAP:URI="480p.mp4",BYTERANGE="800@0"\n#EXTINF:6,\n480p.mp4\n',
      [`${dir}/audio.m3u8`]:
        '#EXTM3U\n#EXT-X-MAP:URI="audio.mp4",BYTERANGE="600@0"\n#EXTINF:6,\naudio.mp4\n',
    };
    const readFile = (absolute: string) => {
      const ref =
        "/" + path.relative(projectRoot, absolute).split(path.sep).join("/");
      return files[ref] === undefined ? undefined : Buffer.from(files[ref]);
    };
    expect(
      filesOfVideo(
        {
          path: `${dir}/master.m3u8`,
          mimeType: "application/vnd.apple.mpegurl",
          poster: { path: `${dir}-poster_def34.jpg` },
        },
        { projectRoot, readFile },
      ).sort(),
    ).toEqual(
      [
        `${dir}/master.m3u8`,
        `${dir}-poster_def34.jpg`,
        `${dir}/audio.m3u8`,
        `${dir}/audio.mp4`,
        `${dir}/720p.m3u8`,
        `${dir}/720p.mp4`,
        `${dir}/480p.m3u8`,
        `${dir}/480p.mp4`,
      ].sort(),
    );
  });

  test("a remote stream names only its master: its playlists are on the content host", () => {
    const ref =
      "https://remote.val.build/file/p/proj/b/01/v/1.0.0/h/abc/f/def/p/public/val/clip_abc12/master.m3u8";
    const readFile = jest.fn(() => undefined);
    expect(
      filesOfVideo(
        { path: ref, mimeType: "application/vnd.apple.mpegurl" },
        { projectRoot, readFile },
      ),
    ).toEqual([ref]);
    expect(readFile).not.toHaveBeenCalled();
  });

  test("not a video value: nothing", () => {
    expect(filesOfVideo(null, { projectRoot })).toEqual([]);
    expect(filesOfVideo({ alt: "x" }, { projectRoot })).toEqual([]);
  });
});
