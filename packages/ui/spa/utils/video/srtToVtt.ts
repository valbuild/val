/**
 * SubRip (`.srt`) to WebVTT, which is the only caption format a `<track>`
 * plays.
 *
 * `.srt` is what most editing tools and transcription services hand out, so
 * refusing it would send every editor off to find a converter for a change
 * this small: a `WEBVTT` header, and a `.` instead of a `,` before the
 * milliseconds. The cue numbers are valid VTT cue identifiers and stay.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(
      /(\d{1,2}:\d{2}:\d{2}),(\d{3})/g,
      (_, time: string, ms: string) => `${time}.${ms}`,
    )
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

export function isVtt(text: string): boolean {
  return /^\uFEFF?WEBVTT/.test(text);
}
