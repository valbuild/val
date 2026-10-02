import { ReactNode, useEffect, useRef } from "react";
import { urlOf } from "@valbuild/shared/internal";
import { ShellBreakpoint } from "./types";

/**
 * `<val-project-switcher>`, Val Build's project menu, around the project name
 * the top bar has always shown.
 *
 * The component is served by Val Build, not shipped in this package, so it
 * can change without a Val release (valbuild/home, `web-components/`). Its
 * data comes through this app's own server — `/api/val/admin/proxy`, which
 * attaches the editor's token — because the token is in an httpOnly cookie
 * the browser cannot hand to admin.val.build.
 *
 * `children` is the fallback, and it is what the editor sees whenever the
 * component cannot show itself: until the script arrives, forever if it never
 * does (offline, blocked by a content security policy), and again if the
 * component throws. That is the browser's own behaviour for an element nobody
 * has defined, plus the component's error handling — nothing here has to
 * decide which.
 */
export function ProjectSwitcher({
  projectName,
  projectHref,
  webComponentsUrl,
  studioMode,
  breakpoint,
  children,
  loadScript = loadWebComponentScript,
}: {
  /** `org/name`. */
  projectName: string;
  projectHref: string;
  /** `toWebComponentsUrl`: `{appHost}/wc/v1`. */
  webComponentsUrl: string;
  /**
   * The component's `mode`. Locally (`fs`) an expired login is fixed by
   * running `val login`, so it says that instead of offering a sign-in.
   */
  studioMode?: "fs" | "http";
  breakpoint: ShellBreakpoint;
  children: ReactNode;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const src = `${webComponentsUrl}/project-switcher.js`;

  useEffect(() => {
    loadScript(src).catch(() => {
      // The fallback is already on screen; there is nothing better to show.
    });
  }, [src, loadScript]);

  // The component asks to sign in when Val Build says the session is gone;
  // signing in is this app's flow, so it is answered here.
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onSignIn = () => {
      window.location.assign(
        urlOf("/api/val/authorize", { redirect_to: window.location.href }),
      );
    };
    element.addEventListener("val-sign-in", onSignIn);
    return () => element.removeEventListener("val-sign-in", onSignIn);
  }, []);

  return (
    <val-project-switcher
      ref={ref}
      className="min-w-0"
      project={projectName}
      api-base="/api/val/admin/proxy"
      admin-url={projectHref}
      layout={breakpoint === "mobile" ? "sheet" : "popover"}
      mode={studioMode}
    >
      {children}
    </val-project-switcher>
  );
}

const scripts = new Map<string, Promise<void>>();

/**
 * Adds `<script type="module" src>` to the page, once per `src`.
 *
 * A script element rather than `import(src)`: this package is bundled by
 * Vite, by preconstruct and by whatever the host app uses, and each wants its
 * own comment before it leaves a runtime URL in an `import()` alone. A script
 * element means the same thing to all of them. A failed load is forgotten, so
 * the next mount tries again.
 */
export function loadWebComponentScript(src: string): Promise<void> {
  const existing = scripts.get(src);
  if (existing !== undefined) {
    return existing;
  }
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "module";
    script.crossOrigin = "anonymous";
    script.src = src;
    script.dataset.valWebComponent = "";
    script.onload = () => resolve();
    script.onerror = () => {
      scripts.delete(src);
      script.remove();
      reject(new Error(`Could not load ${src}`));
    };
    document.head.appendChild(script);
  });
  scripts.set(src, loading);
  return loading;
}
