/**
 * `video:upload-remote` and `video:download-remote`: move a video between the
 * repository and Val Remote.
 *
 * A video is the one media value that names several files — the video, its
 * poster, its caption tracks, and for an HLS stream every playlist and segment
 * its master names — so one fix moves all of them, and the patch then rewrites
 * every `path` the value holds. Moving only some would leave a video that is
 * half on each side, which validation rejects and no page can play.
 *
 * HLS is the part that is not a copy. The content host serves a file by its
 * HASH, so a relative name in a playlist resolves to nothing there: on the way
 * UP every playlist is rewritten to name the refs of what it lists, bottom-up
 * (a playlist's ref is the hash of its rewritten bytes, so what it names must
 * be uploaded first). On the way DOWN the same playlists are rewritten back to
 * relative names, which is what lets a published stream be plain static files.
 */
import fs from "fs";
import path from "path";
import { Internal, type SerializedVideoSchema } from "@valbuild/core";
import { sourceToPatchPath } from "@valbuild/core/patch";
import type { Patch } from "@valbuild/core/patch";
import type { SourcePath } from "@valbuild/core";
import type { FixHandlerContext, FixHandlerResult } from "./fixHandlers";
import { mapHlsUris } from "./hls";
import { openRemoteUploadSession, uploadBytesToRemote } from "./remoteUpload";
import { downloadFileFromRemote } from "./checkRemoteRef";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaylist(ref: string): boolean {
  return ref.split("?")[0].toLowerCase().endsWith(".m3u8");
}

/** The paths a video value holds, each with where in the value it sits. */
export function videoPathsOf(video: unknown): { at: string[]; path: string }[] {
  if (!isRecord(video) || typeof video.path !== "string") {
    return [];
  }
  const found = [{ at: ["path"], path: video.path }];
  if (isRecord(video.poster) && typeof video.poster.path === "string") {
    found.push({ at: ["poster", "path"], path: video.poster.path });
  }
  if (Array.isArray(video.captions)) {
    video.captions.forEach((track, index) => {
      if (isRecord(track) && typeof track.path === "string") {
        found.push({
          at: ["captions", String(index), "path"],
          path: track.path,
        });
      }
    });
  }
  return found;
}

/**
 * The patch that points a video at where its files now are: one `add` per
 * path that moved, so the authored fields beside them — the description, the
 * times, the caption labels — are never rewritten.
 */
export function rewriteVideoPathsPatch(
  sourcePath: SourcePath,
  video: unknown,
  moved: Record<string, string>,
): Patch {
  const base = sourceToPatchPath(sourcePath);
  const patch: Patch = [];
  for (const { at, path: current } of videoPathsOf(video)) {
    const to = moved[current];
    if (to !== undefined && to !== current) {
      patch.push({ op: "add", path: base.concat(at), value: to });
    }
  }
  return patch;
}

/** A relative playlist URI as a `/public/...` ref, or undefined if it is not one. */
function resolvePlaylistUri(uri: string, playlist: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("/")) {
    return undefined;
  }
  const relative = uri.split(/[?#]/)[0];
  if (relative === "") {
    return undefined;
  }
  return path.posix.join(path.posix.dirname(playlist), relative);
}

function playlistUris(text: string): string[] {
  const uris: string[] = [];
  mapHlsUris(text, (uri) => {
    if (!uris.includes(uri)) uris.push(uri);
    return uri;
  });
  return uris;
}

/**
 * What a file's validation hash is computed from — the same as the Studio
 * computes for an upload (`createVideoPatch`), so a video moved by the CLI and
 * one uploaded in the Studio carry refs of the same kind.
 */
function metadataOf(
  localRef: string,
  role: "video" | "poster" | "caption" | "stream",
  video: Record<string, unknown>,
): Record<string, unknown> {
  const mimeType = Internal.filenameToMimeType(localRef);
  if (role === "video") {
    return { mimeType, width: video.width, height: video.height };
  }
  if (role === "poster" && isRecord(video.poster)) {
    return {
      mimeType: video.poster.mimeType ?? mimeType,
      width: video.poster.width,
      height: video.poster.height,
    };
  }
  return { mimeType };
}

function resolveVideo(ctx: FixHandlerContext):
  | {
      success: true;
      video: Record<string, unknown>;
      schema: SerializedVideoSchema;
    }
  | { success: false; result: FixHandlerResult } {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    ctx.sourcePath,
  );
  if (!ctx.valModule.source || !ctx.valModule.schema) {
    return {
      success: false,
      result: {
        success: false,
        errorMessage: `Could not resolve source or schema for ${ctx.sourcePath}`,
      },
    };
  }
  const resolved = Internal.resolvePath(
    modulePath,
    ctx.valModule.source,
    ctx.valModule.schema,
  );
  const video: unknown = resolved.source;
  if (
    resolved.schema?.type !== "video" ||
    !isRecord(video) ||
    typeof video.path !== "string"
  ) {
    return {
      success: false,
      result: {
        success: false,
        errorMessage: `Expected a video at ${ctx.sourcePath}`,
      },
    };
  }
  return { success: true, video, schema: resolved.schema };
}

export async function handleVideoUploadRemote(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (!ctx.fix) {
    return {
      success: false,
      errorMessage: `Video needs to be uploaded to Val Remote (use --fix to upload)`,
    };
  }
  const resolved = resolveVideo(ctx);
  if (!resolved.success) {
    return resolved.result;
  }
  const { video, schema } = resolved;
  if (ctx.remoteFiles[ctx.sourcePath]) {
    return {
      success: true,
      shouldApplyPatch: true,
      events: [
        { type: "remote-already-uploaded", filePath: String(video.path) },
      ],
    };
  }

  const toUpload = videoPathsOf(video).filter(
    ({ path: ref }) => !Internal.isRemoteMediaPath(ref),
  );
  // Every file is checked before any goes up: a missing caption found after
  // the video was uploaded leaves bytes on the content host that nothing names.
  for (const { path: ref } of toUpload) {
    const absolute = path.join(ctx.projectRoot, ref);
    if (!ctx.fs.fileExists(absolute)) {
      return {
        success: false,
        errorMessage: `File ${absolute} does not exist`,
      };
    }
  }

  const opened = await openRemoteUploadSession(ctx);
  if (!opened.success) {
    return opened.result;
  }
  const { session } = opened;
  const moved = new Map<string, string>();
  const events: FixHandlerResult["events"] = [];

  const put = async (
    localRef: string,
    role: "video" | "poster" | "caption" | "stream",
  ): Promise<string> => {
    const already = moved.get(localRef);
    if (already !== undefined) {
      return already;
    }
    const absolute = path.join(ctx.projectRoot, localRef);
    const buffer = ctx.fs.readBuffer(absolute);
    if (buffer === undefined) {
      throw new Error(`Error reading file: ${absolute}`);
    }
    let bytes = buffer;
    if (isPlaylist(localRef)) {
      // Bottom-up: what this playlist names goes up first, so the refs it is
      // rewritten to exist — and so its own hash is of the rewritten bytes.
      const text = buffer.toString("utf-8");
      const refs = new Map<string, string>();
      for (const uri of playlistUris(text)) {
        const target = resolvePlaylistUri(uri, localRef);
        if (target !== undefined) {
          refs.set(uri, await put(target, "stream"));
        }
      }
      bytes = Buffer.from(
        mapHlsUris(text, (uri) => refs.get(uri) ?? uri),
        "utf-8",
      );
    }
    const uploaded = await uploadBytesToRemote(
      ctx,
      session,
      localRef.replace(/^\//, ""),
      bytes,
      metadataOf(localRef, role, video),
      schema,
    );
    if (!uploaded.success) {
      throw new Error(uploaded.error);
    }
    moved.set(localRef, uploaded.ref);
    events.push({ type: "remote-uploaded", ref: uploaded.ref });
    return uploaded.ref;
  };

  try {
    for (const { at, path: ref } of toUpload) {
      await put(
        ref,
        at[0] === "poster"
          ? "poster"
          : at[0] === "captions"
            ? "caption"
            : "video",
      );
    }
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const refs = Object.fromEntries(moved);
  ctx.remoteFiles[ctx.sourcePath] = {
    ref: refs[String(video.path)] ?? String(video.path),
    refs,
  };
  return {
    success: true,
    shouldApplyPatch: true,
    publicProjectId: session.publicProjectId,
    remoteFileBuckets: session.remoteFileBuckets,
    remoteFilesCounter: session.remoteFilesCounter,
    events,
  };
}

export async function handleVideoDownloadRemote(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (!ctx.fix) {
    return {
      success: false,
      errorMessage: `Video ${ctx.sourcePath} needs to be downloaded (use --fix to download)`,
    };
  }
  const resolved = resolveVideo(ctx);
  if (!resolved.success) {
    return resolved.result;
  }
  const { video } = resolved;
  const moved = new Map<string, string>();

  const fetchTo = async (ref: string): Promise<string> => {
    const already = moved.get(ref);
    if (already !== undefined) {
      return already;
    }
    const split = Internal.remote.splitRemoteRef(ref);
    if (split.status === "error") {
      throw new Error(`Not a Val Remote ref: ${ref} (${split.error})`);
    }
    if (!split.filePath.startsWith("public/")) {
      throw new Error(
        `Cannot download ${ref}: its file path must start with public/ (got ${split.filePath})`,
      );
    }
    const localRef = `/${split.filePath}`;
    const absolute = path.join(ctx.projectRoot, split.filePath);
    await fs.promises.mkdir(path.dirname(absolute), { recursive: true });
    const res = await downloadFileFromRemote(ref, absolute);
    if (res.status === "error") {
      throw new Error(res.error);
    }
    moved.set(ref, localRef);
    if (isPlaylist(localRef)) {
      // Back to relative names: a local stream is plain static files, and the
      // draft endpoint rewrites relative names, not refs.
      const text = fs.readFileSync(absolute, "utf-8");
      const local = new Map<string, string>();
      for (const uri of playlistUris(text)) {
        if (Internal.remote.splitRemoteRef(uri).status === "success") {
          const target = await fetchTo(uri);
          local.set(
            uri,
            path.posix.relative(path.posix.dirname(localRef), target),
          );
        }
      }
      fs.writeFileSync(
        absolute,
        mapHlsUris(text, (uri) => local.get(uri) ?? uri),
        "utf-8",
      );
    }
    return localRef;
  };

  try {
    for (const { path: ref } of videoPathsOf(video)) {
      if (Internal.isRemoteMediaPath(ref)) {
        await fetchTo(ref);
      }
    }
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  const refs = Object.fromEntries(moved);
  ctx.remoteFiles[ctx.sourcePath] = {
    ref: refs[String(video.path)] ?? String(video.path),
    refs,
  };
  return {
    success: true,
    shouldApplyPatch: true,
    events: [{ type: "remote-downloading", sourcePath: ctx.sourcePath }],
  };
}
