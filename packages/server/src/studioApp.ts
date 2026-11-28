import {
  STUDIO_ICON_PATHS,
  STUDIO_MANIFEST_PATH,
  STUDIO_SERVICE_WORKER_PATH,
  STUDIO_SERVICE_WORKER_SOURCE,
  STUDIO_WORKER_SCOPE,
  studioAppIconFromQuery,
  studioManifest,
  ValServerGenericResult,
} from "@valbuild/shared/internal";
import { base64ToBytes } from "./bytes";
import {
  STUDIO_ICON_180_PNG_BASE64,
  STUDIO_ICON_192_PNG_BASE64,
  STUDIO_ICON_512_PNG_BASE64,
} from "./studioAppIcons";

const ICONS: Record<string, string> = {
  [STUDIO_ICON_PATHS[180]]: STUDIO_ICON_180_PNG_BASE64,
  [STUDIO_ICON_PATHS[192]]: STUDIO_ICON_192_PNG_BASE64,
  [STUDIO_ICON_PATHS[512]]: STUDIO_ICON_512_PNG_BASE64,
};

/**
 * The files that make the Studio installable (`studioApp.ts` in
 * `@valbuild/shared`), or `null` when `path` is not one of them.
 *
 * Public, like the Studio's scripts: none of them says anything about the
 * project but the host it is served on, which the asker already knows.
 */
export function serveStudioAppFile(
  path: string,
  url: URL,
  route: string,
): ValServerGenericResult | null {
  if (path === STUDIO_MANIFEST_PATH) {
    return {
      status: 200,
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
      body: JSON.stringify(
        studioManifest(
          url.host,
          route,
          studioAppIconFromQuery(url.searchParams),
        ),
      ),
    };
  }
  if (path === STUDIO_SERVICE_WORKER_PATH) {
    return {
      status: 200,
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        // Served under the API route, controlling the Studio's route.
        "Service-Worker-Allowed": STUDIO_WORKER_SCOPE,
        "Cache-Control": "no-cache",
      },
      body: STUDIO_SERVICE_WORKER_SOURCE,
    };
  }
  const icon = ICONS[path];
  if (icon !== undefined) {
    const bytes = base64ToBytes(icon);
    return {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
  return null;
}
