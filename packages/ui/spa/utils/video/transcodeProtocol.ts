/**
 * The messages between the Studio and `transcode.worker.ts`.
 *
 * One request per worker: a worker is started for an upload and terminated
 * when it answers, so there is no id to match replies on.
 */
export type TranscodeRequest = {
  type: "transcode";
  file: Blob;
  /** The heights asked for; the worker drops those taller than the upload. */
  renditions: number[];
  segmentDuration: number;
};

export type TranscodedFile = {
  /** Relative to the master playlist, e.g. `playlist-1.m3u8`. */
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
};

export type TranscodeReply =
  | { type: "progress"; progress: number }
  | {
      type: "done";
      /** The master playlist is always first. */
      files: TranscodedFile[];
      width: number;
      height: number;
      duration: number;
    }
  | {
      type: "error";
      message: string;
      /**
       * The browser cannot do this at all — no H.264 encoder, say — as opposed
       * to this file having failed. The caller uploads the original instead.
       */
      unsupported: boolean;
    };
