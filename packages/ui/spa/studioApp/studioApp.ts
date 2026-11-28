import {
  STUDIO_APP_BACKGROUND,
  STUDIO_APP_SCOPE,
  STUDIO_ICON_PATHS,
  STUDIO_MANIFEST_PATH,
  STUDIO_SERVICE_WORKER_PATH,
} from "@valbuild/shared/internal";
import { Internal } from "@valbuild/core";

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

  addHeadElements(apiRoute);

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
  link("manifest", `${apiRoute}${STUDIO_MANIFEST_PATH}`);
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
