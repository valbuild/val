import { Internal } from "@valbuild/core";
import { rewriteDraftPlaylist } from "./rewriteDraftPlaylist";

const PATCH_ID = "6f4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c";

describe("rewriteDraftPlaylist", () => {
  describe("a local stream (relative URIs)", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud"',
      "720p.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud"',
      "480p.m3u8",
      "",
    ].join("\n");

    test("every URI points at the draft endpoint, with the playlist's patch_id", () => {
      expect(
        rewriteDraftPlaylist(master, {
          playlistPath: "/public/val/clip_abc12/master.m3u8",
          patchId: PATCH_ID,
          remote: false,
        }),
      ).toBe(
        [
          "#EXTM3U",
          "#EXT-X-VERSION:7",
          `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,URI="/api/val/files/public/val/clip_abc12/audio.m3u8?patch_id=${PATCH_ID}"`,
          '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud"',
          `/api/val/files/public/val/clip_abc12/720p.m3u8?patch_id=${PATCH_ID}`,
          '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud"',
          `/api/val/files/public/val/clip_abc12/480p.m3u8?patch_id=${PATCH_ID}`,
          "",
        ].join("\n"),
      );
    });

    test("is the same URL mediaUrl gives the file as a draft", () => {
      const rewritten = rewriteDraftPlaylist("720p.m3u8", {
        playlistPath: "/public/val/clip_abc12/master.m3u8",
        patchId: PATCH_ID,
        remote: false,
      });
      expect(rewritten).toBe(
        Internal.mediaUrl({
          path: "/public/val/clip_abc12/720p.m3u8",
          patch_id: PATCH_ID,
        }),
      );
    });

    test("a media playlist: the EXT-X-MAP and each segment line, byte ranges untouched", () => {
      const media = [
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:6",
        '#EXT-X-MAP:URI="720p.mp4",BYTERANGE="807@0"',
        "#EXTINF:6.006,",
        "#EXT-X-BYTERANGE:40000@807",
        "720p.mp4",
        "#EXT-X-ENDLIST",
      ].join("\r\n");
      expect(
        rewriteDraftPlaylist(media, {
          playlistPath: "/public/val/clip_abc12/720p.m3u8",
          patchId: PATCH_ID,
          remote: false,
        }),
      ).toBe(
        [
          "#EXTM3U",
          "#EXT-X-TARGETDURATION:6",
          `#EXT-X-MAP:URI="/api/val/files/public/val/clip_abc12/720p.mp4?patch_id=${PATCH_ID}",BYTERANGE="807@0"`,
          "#EXTINF:6.006,",
          "#EXT-X-BYTERANGE:40000@807",
          `/api/val/files/public/val/clip_abc12/720p.mp4?patch_id=${PATCH_ID}`,
          "#EXT-X-ENDLIST",
          // CRLF in, CRLF out.
        ].join("\r\n"),
      );
    });

    test("./ and ../ resolve against the playlist's own directory", () => {
      expect(
        rewriteDraftPlaylist("./a/b.m3u8\n../shared/c.mp4", {
          playlistPath: "/public/val/clip_abc12/master.m3u8",
          patchId: PATCH_ID,
          remote: false,
        }),
      ).toBe(
        `/api/val/files/public/val/clip_abc12/a/b.m3u8?patch_id=${PATCH_ID}\n` +
          `/api/val/files/public/val/shared/c.mp4?patch_id=${PATCH_ID}`,
      );
    });

    test("a relative URI's own query string is dropped for the draft endpoint's", () => {
      expect(
        rewriteDraftPlaylist("720p.mp4?v=2", {
          playlistPath: "/public/val/clip_abc12/720p.m3u8",
          patchId: PATCH_ID,
          remote: false,
        }),
      ).toBe(
        `/api/val/files/public/val/clip_abc12/720p.mp4?patch_id=${PATCH_ID}`,
      );
    });
  });

  describe("a remote stream (absolute Val remote refs)", () => {
    const ref =
      "https://remote.val.build/file/p/proj123/b/01/v/0.138.5/h/abcdef/f/0123456789ab/p/public/val/clip_abc12/720p.mp4";

    test("a remote ref becomes the remote draft URL mediaUrl produces", () => {
      const out = rewriteDraftPlaylist(
        `#EXT-X-MAP:URI="${ref}",BYTERANGE="807@0"\n#EXTINF:6.0,\n${ref}\n`,
        {
          playlistPath: "/public/val/clip_abc12/720p.m3u8",
          patchId: PATCH_ID,
          remote: true,
        },
      );
      const draft = `/api/val/files/public/val/clip_abc12/720p.mp4?patch_id=${PATCH_ID}&remote=true&ref=${encodeURIComponent(ref)}`;
      expect(draft).toBe(Internal.mediaUrl({ path: ref, patch_id: PATCH_ID }));
      expect(out).toBe(
        `#EXT-X-MAP:URI="${draft}",BYTERANGE="807@0"\n#EXTINF:6.0,\n${draft}\n`,
      );
    });

    test("a relative URI in a remote draft keeps remote=true", () => {
      expect(
        rewriteDraftPlaylist("720p.m3u8", {
          playlistPath: "/public/val/clip_abc12/master.m3u8",
          patchId: PATCH_ID,
          remote: true,
        }),
      ).toBe(
        `/api/val/files/public/val/clip_abc12/720p.m3u8?patch_id=${PATCH_ID}&remote=true`,
      );
    });
  });

  test("other absolute URLs, root-relative paths and tags without a URI are left alone", () => {
    const playlist = [
      "#EXTM3U",
      '#EXT-X-SESSION-DATA:DATA-ID="com.example.title",VALUE="A URI=\\"x\\" in a value"',
      "https://cdn.example.com/stream/720p.m3u8",
      "//cdn.example.com/480p.m3u8",
      "/val/clip_abc12/360p.m3u8",
      '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k1"',
    ].join("\n");
    expect(
      rewriteDraftPlaylist(playlist, {
        playlistPath: "/public/val/clip_abc12/master.m3u8",
        patchId: PATCH_ID,
        remote: false,
      }),
    ).toBe(playlist);
  });
});
