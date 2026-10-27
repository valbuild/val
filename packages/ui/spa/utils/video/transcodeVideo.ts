import type {
  TranscodeReply,
  TranscodeRequest,
  TranscodedFile,
} from "./transcodeProtocol";

export type TranscodeResult =
  | {
      status: "done";
      files: TranscodedFile[];
      width: number;
      height: number;
      duration: number;
    }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

export function transcodeToHls(
  file: Blob,
  options: { renditions: number[]; segmentDuration: number },
  onProgress: (progress: number) => void,
): Promise<TranscodeResult> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./transcode.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch (err) {
      resolve({
        status: "unsupported",
        message: `Could not start the video converter: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    const finish = (result: TranscodeResult) => {
      worker.terminate();
      resolve(result);
    };
    worker.onerror = (event) => {
      finish({
        status: "unsupported",
        message: `The video converter stopped: ${event.message || "it failed to start"}`,
      });
    };
    worker.onmessage = (event: MessageEvent<TranscodeReply>) => {
      const reply = event.data;
      if (reply.type === "progress") {
        onProgress(reply.progress);
      } else if (reply.type === "done") {
        finish({
          status: "done",
          files: reply.files,
          width: reply.width,
          height: reply.height,
          duration: reply.duration,
        });
      } else if (reply.unsupported) {
        finish({ status: "unsupported", message: reply.message });
      } else {
        finish({ status: "error", message: reply.message });
      }
    };
    const request: TranscodeRequest = {
      type: "transcode",
      file,
      renditions: options.renditions,
      segmentDuration: options.segmentDuration,
    };
    worker.postMessage(request);
  });
}
