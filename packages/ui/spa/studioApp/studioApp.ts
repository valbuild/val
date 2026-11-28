import {
  STUDIO_APP_BACKGROUND,
  STUDIO_APP_SCOPE,
  STUDIO_ICON_PATHS,
  STUDIO_SERVICE_WORKER_PATH,
  StudioAppIcon,
  studioManifestUrl,
} from "@valbuild/shared/internal";
import { Internal } from "@valbuild/core";
import type { ThemeLogo, ThemeLogoImage } from "../hooks/themeSettings";

/**
 * How this Studio can be put on the device's home screen, if it can.
 *
 * - `prompt`: the browser offered to install it (`beforeinstallprompt`:
 *   Chrome, Edge, Samsung Internet, Android); a button can ask it to.
 * - `ios`: Safari on iPhone or iPad, which has no prompt to ask for. It can
 *   only be done from the Share menu, so the Studio says how.
 * - `none`: already installed, opened as the app, in a demo, or a browser
 *   that cannot install a site.
 */
export type StudioInstall =
  | { kind: "none" }
  | { kind: "prompt"; install: () => Promise<void> }
  | { kind: "ios" };

/** The event Chromium fires; not in the DOM typings. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isBeforeInstallPromptEvent(
  event: Event,
): event is BeforeInstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

const NONE: StudioInstall = { kind: "none" };
let current: StudioInstall = NONE;
const listeners = new Set<() => void>();

function set(next: StudioInstall) {
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeStudioInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStudioInstall(): StudioInstall {
  return current;
}

/** Opened from the home screen rather than in a browser tab. */
export function isStandalone(win: Window = window): boolean {
  return (
    win.matchMedia?.("(display-mode: standalone)").matches === true ||
    ("standalone" in win.navigator && win.navigator.standalone === true)
  );
}

/**
 * Safari on an iPhone or iPad. An iPad asks for the desktop site and so
 * reports itself as a Mac; the touch points are what give it away.
 */
export function isIosSafari(
  nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator,
): boolean {
  const ua = nav.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  // Every browser on iOS is WebKit, but only Safari's Share menu has "Add to
  // Home Screen" in every version; the others name themselves.
  return ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

let started = false;
let route: string | null = null;
let icon: StudioAppIcon | null = null;

/**
 * The smallest icon Chrome installs an app with. A smaller logo would not be
 * an app with a worse icon: the browser would stop offering to install it.
 */
const MIN_ICON_SIZE = 144;
/** How far from square a logo may be and still fill a home-screen tile. */
const MAX_ICON_ASPECT = 1.25;

/**
 * `s.settings()`'s `theme.logo` as the app's icon, or `null` to keep Val's.
 *
 * Only when it can stand on a home screen:
 *
 * - **Published.** A logo with a patch id is bytes only this Studio session
 *   can read; an icon is fetched once, when the app is installed, and kept.
 * - **An SVG, or a raster at least {@link MIN_ICON_SIZE} pixels and about
 *   square** — the settings ask for "a square-ish mark rather than a
 *   wordmark", and a wordmark letterboxed into a tile is unreadable.
 *   Dimensions that were never read from the bytes (no `val validate --fix`
 *   yet) say nothing, so they keep Val's.
 */
export function studioAppIconOf(
  logo: ThemeLogo | null,
  image: ThemeLogoImage | undefined,
  filePatchIds: ReadonlyMap<string, string>,
): StudioAppIcon | null {
  if (logo === null || filePatchIds.has(logo.path)) return null;
  const src = Internal.mediaUrl({ path: logo.path });
  const { width, height, mimeType } = image ?? {};
  if (mimeType === "image/svg+xml") {
    return { src, type: mimeType, sizes: "any" };
  }
  if (
    width === undefined ||
    height === undefined ||
    (mimeType !== "image/png" &&
      mimeType !== "image/jpeg" &&
      mimeType !== "image/webp")
  ) {
    return null;
  }
  const square =
    Math.max(width, height) / Math.min(width, height) <= MAX_ICON_ASPECT;
  if (!square || Math.min(width, height) < MIN_ICON_SIZE) return null;
  return { src, type: mimeType, sizes: `${width}x${height}` };
}

/**
 * Use the project's icon, or Val's again with `null`. Called whenever the
 * settings' logo changes; before the Studio app has started (or in a demo,
 * where it never does) it is only remembered.
 */
export function setStudioAppIcon(next: StudioAppIcon | null): void {
  if (
    next?.src === icon?.src &&
    next?.type === icon?.type &&
    next?.sizes === icon?.sizes
  ) {
    return;
  }
  icon = next;
  if (started) applyIcon();
}

/**
 * Point the manifest and the iOS icon at the current icon. iOS takes only
 * PNG and JPEG for `apple-touch-icon`, so an SVG or WebP logo is the app's
 * icon everywhere but there.
 */
function applyIcon() {
  if (route === null) return;
  const manifest = document.head.querySelector<HTMLLinkElement>(
    'link[rel="manifest"][data-val-studio-app]',
  );
  manifest?.setAttribute("href", studioManifestUrl(route, icon));
  const apple = document.head.querySelector<HTMLLinkElement>(
    'link[rel="apple-touch-icon"][data-val-studio-app]',
  );
  if (apple) {
    const own =
      icon !== null && (icon.type === "image/png" || icon.type === "image/jpeg")
        ? icon
        : null;
    apple.setAttribute(
      "href",
      own ? own.src : `${route}${STUDIO_ICON_PATHS[180]}`,
    );
    apple.setAttribute("sizes", own ? own.sizes : "180x180");
  }
}

/**
 * Make the Studio at `/val` installable: link the manifest and the iOS tags,
 * register the worker that caches the Studio's own files, and keep the
 * browser's install offer for the button in the account panel.
 *
 * Done by the Studio rather than by `ValApp`, so every framework binding gets
 * it the same way. Once per page.
 *
 * Not in a demo (see `STUDIO_SERVICE_WORKER_SOURCE`).
 */
export function startStudioApp(apiRoute: string): void {
  if (started || typeof window === "undefined") return;
  started = true;
  route = apiRoute;

  addHeadElements(apiRoute);
  applyIcon();

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker
      .register(`${apiRoute}${STUDIO_SERVICE_WORKER_PATH}`, {
        scope: STUDIO_APP_SCOPE,
      })
      .catch((error) => {
        // The Studio works the same without it, only slower to start.
        Internal.log.debug("Could not register the Studio's worker", error);
      });
  }

  if (isStandalone()) return;
  if (isIosSafari()) {
    set({ kind: "ios" });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    if (!isBeforeInstallPromptEvent(event)) return;
    // Kept for the button instead of the browser's own mini-infobar.
    event.preventDefault();
    set({
      kind: "prompt",
      install: async () => {
        await event.prompt();
        const choice = await event.userChoice;
        // The event can be used once; the browser fires another if it is
        // still installable after a dismissal.
        if (choice.outcome === "accepted") set(NONE);
      },
    });
  });
  window.addEventListener("appinstalled", () => set(NONE));
}

/**
 * The manifest first in `<head>`: a browser reads the FIRST manifest link,
 * and the site the Studio is mounted in may have its own, whose app is the
 * site rather than its Studio.
 */
function addHeadElements(apiRoute: string) {
  const head = document.head;
  const elements: HTMLElement[] = [];
  const link = (rel: string, href: string, sizes?: string) => {
    const el = document.createElement("link");
    el.rel = rel;
    el.href = href;
    if (sizes) el.setAttribute("sizes", sizes);
    elements.push(el);
  };
  const meta = (name: string, content: string) => {
    const el = document.createElement("meta");
    el.name = name;
    el.content = content;
    elements.push(el);
  };
  link("manifest", studioManifestUrl(apiRoute, null));
  link("apple-touch-icon", `${apiRoute}${STUDIO_ICON_PATHS[180]}`, "180x180");
  meta("apple-mobile-web-app-capable", "yes");
  meta("mobile-web-app-capable", "yes");
  meta("apple-mobile-web-app-title", "Val");
  meta("apple-mobile-web-app-status-bar-style", "black");
  if (!head.querySelector('meta[name="theme-color"]')) {
    meta("theme-color", STUDIO_APP_BACKGROUND);
  }
  for (const el of elements.reverse()) {
    el.setAttribute("data-val-studio-app", "");
    head.prepend(el);
  }
}
