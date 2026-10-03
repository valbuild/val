import { mapPlaylistUris, playlistUris } from "./hlsPlaylist";
import { isVtt, srtToVtt } from "./srtToVtt";

const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,URI="playlist-3.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="audio"
playlist-1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO="audio"
playlist-2.m3u8
`;

const MEDIA = `#EXTM3U\r
#EXT-X-TARGETDURATION:6\r
#EXT-X-MAP:URI="segments-1.mp4",BYTERANGE="812@0"\r
#EXTINF:6.0,\r
#EXT-X-BYTERANGE:120000@812\r
segments-1.mp4\r
#EXT-X-ENDLIST\r
`;

describe("mapPlaylistUris", () => {
  test("rewrites URI lines and URI attributes, and nothing else", () => {
    const res = mapPlaylistUris(MASTER, (uri) => `https://cdn/${uri}`);
    expect(res).toBe(
      MASTER.replace(
        'URI="playlist-3.m3u8"',
        'URI="https://cdn/playlist-3.m3u8"',
      )
        .replace("\nplaylist-1.m3u8", "\nhttps://cdn/playlist-1.m3u8")
        .replace("\nplaylist-2.m3u8", "\nhttps://cdn/playlist-2.m3u8"),
    );
  });

  test("keeps CRLF line endings and byte ranges", () => {
    const res = mapPlaylistUris(MEDIA, (uri) => `x/${uri}`);
    expect(res).toContain(
      '#EXT-X-MAP:URI="x/segments-1.mp4",BYTERANGE="812@0"\r\n',
    );
    expect(res).toContain(
      "#EXT-X-BYTERANGE:120000@812\r\nx/segments-1.mp4\r\n",
    );
  });

  test("lists every uri once", () => {
    expect(playlistUris(MASTER)).toEqual([
      "playlist-3.m3u8",
      "playlist-1.m3u8",
      "playlist-2.m3u8",
    ]);
    expect(playlistUris(MEDIA)).toEqual(["segments-1.mp4"]);
  });
});

describe("srtToVtt", () => {
  test("adds the header and fixes the millisecond separator", () => {
    const srt =
      "\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n";
    expect(srtToVtt(srt)).toBe(
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello\n\n2\n00:00:03.000 --> 00:00:04.000\nWorld\n",
    );
    expect(isVtt(srtToVtt(srt))).toBe(true);
    expect(isVtt(srt)).toBe(false);
  });
});
