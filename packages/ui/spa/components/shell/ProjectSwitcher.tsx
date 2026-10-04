import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { urlOf } from "@valbuild/shared/internal";
import { ShellBreakpoint } from "./types";

/**
 * Val Build's project menu, behind the project's name in the top bar.
 *
 * The Studio draws the name — and the chevron that says there is a menu — so
 * it looks like the rest of the bar and is the same before and after anything
 * loads: no layout shift, and nothing fetched from Val Build at start. The
 * menu is `<val-project-switcher>`, served by Val Build (valbuild/home,
 * `web-components/`) so it can change without a Val release, and it is loaded
 * when the name is first hovered or clicked (`useLazyWebComponent`). It sits
 * around the Studio's button as `trigger="slot"`: the component draws only
 * the panel, anchored to that button.
 *
 * Its data comes through this app's own server — `/api/val/admin/proxy`,
 * which attaches the editor's token — because the token is in an httpOnly
 * cookie the browser cannot hand to admin.val.build.
 *
 * Opening a Studio puts its project at the top of the editor's Recent in Val
 * Build. That used to happen when the component mounted, which is now the
 * first click, so the Studio records the visit itself (`recordOpened`).
 */
export function ProjectSwitcher({
  projectName,
  projectHref,
  webComponentsUrl,
  studioMode,
  breakpoint,
  loadScript = loadWebComponentScript,
}: {
  /** `org/name`. */
  projectName: string;
  projectHref: string;
  /** `toWebComponentsUrl`: `{contentHost}/wc/v1`. */
  webComponentsUrl: string;
  /**
   * The component's `mode`. Locally (`fs`) an expired login is fixed by
   * running `val login`, so it says that instead of offering a sign-in.
   */
  studioMode?: "fs" | "http";
  breakpoint: ShellBreakpoint;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const lazy = useLazyWebComponent({
    tag: "val-project-switcher",
    src: `${webComponentsUrl}/project-switcher.js`,
    fallbackHref: projectHref,
    loadScript,
  });

  useEffect(() => {
    recordOpened(projectName);
  }, [projectName]);

  return (
    <val-project-switcher
      ref={lazy.ref}
      className="inline-flex min-w-0"
      project={projectName}
      api-base={ADMIN_PROXY}
      admin-url={projectHref}
      layout={breakpoint === "mobile" ? "sheet" : "popover"}
      trigger="slot"
      mode={studioMode}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={lazy.open}
        title={projectName}
        onClick={lazy.onClick}
        onPointerEnter={lazy.prefetch}
        onFocus={lazy.prefetch}
        className="group inline-flex items-center gap-1 min-w-0 max-w-full h-7 pl-2 pr-1.5 rounded-md text-[0.8125rem] font-semibold tracking-[-0.01em] hover:bg-bg-float-raised aria-expanded:bg-bg-float-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
      >
        <span className="min-w-0 truncate">{nameOfProject(projectName)}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className="shrink-0 text-fg-secondary transition-transform group-aria-expanded:rotate-180"
        />
      </button>
    </val-project-switcher>
  );
}

/** Where the Studio's server forwards to Val Build. See `adminProxy.ts`. */
export const ADMIN_PROXY = "/api/val/admin/proxy";

/** `site` of `acme/site`: what the switcher shows. Anything else as it is. */
export function nameOfProject(projectName: string): string {
  const [org, name, ...rest] = projectName.split("/");
  return org && name && rest.length === 0 ? name : projectName;
}

const recorded = new Set<string>();

/**
 * This Studio was opened: Val Build puts the project at the top of the
 * editor's Recent. Once per project per page, and quietly — a Recent list one
 * visit behind is not worth an error.
 */
function recordOpened(projectName: string) {
  if (recorded.has(projectName)) return;
  recorded.add(projectName);
  fetch(
    `${ADMIN_PROXY}/projects/opened?project=${encodeURIComponent(projectName)}`,
    { method: "POST", headers: { "x-val-studio": "1" } },
  ).catch(() => undefined);
}

/**
 * A Val Build web component behind a trigger the Studio draws, loaded when
 * someone reaches for it rather than when the Studio starts.
 *
 * - Hover or focus fetches the script (`prefetch`), so it is usually there by
 *   the time of the click.
 * - The first click, if the element is not defined yet, sets `open` on it and
 *   loads the script; the component opens its panel as soon as it is defined.
 *   Once it is defined, clicks are the component's own (`trigger="slot"`),
 *   and this does nothing.
 * - A script that cannot load (offline, a strict CSP) sends the click to Val
 *   Build instead (`fallbackHref`), in a new tab: the closest thing to what
 *   was asked for.
 * - `open` follows the component's `val-open-change`, for `aria-expanded` and
 *   the trigger's pressed look; `val-sign-in` is answered with this app's
 *   sign-in, which is the Studio's flow rather than the component's.
 */
export function useLazyWebComponent({
  tag,
  src,
  fallbackHref,
  loadScript = loadWebComponentScript,
}: {
  tag: string;
  src: string;
  fallbackHref: string;
  loadScript?: (src: string) => Promise<void>;
}) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onOpenChange = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        typeof event.detail?.open === "boolean"
      ) {
        setOpen(event.detail.open);
      }
    };
    const onSignIn = () => signIn();
    element.addEventListener("val-open-change", onOpenChange);
    element.addEventListener("val-sign-in", onSignIn);
    return () => {
      element.removeEventListener("val-open-change", onOpenChange);
      element.removeEventListener("val-sign-in", onSignIn);
    };
  }, []);

  const prefetch = useCallback(() => {
    loadScript(src).catch(() => {
      // The click will try again, and fall back if it fails too.
    });
  }, [src, loadScript]);

  const onClick = useCallback(() => {
    if (customElements.get(tag) !== undefined) {
      return;
    }
    const element = ref.current;
    element?.setAttribute("open", "");
    loadScript(src).catch(() => {
      element?.removeAttribute("open");
      window.open(fallbackHref, "_blank", "noopener,noreferrer");
    });
  }, [tag, src, fallbackHref, loadScript]);

  return { ref, open, prefetch, onClick };
}

function signIn() {
  window.location.assign(
    urlOf("/api/val/authorize", { redirect_to: window.location.href }),
  );
}

/**
 * A Val Build web component the Studio shows straight away (the AI setup is a
 * panel, not a trigger): its script, loaded on mount, and an answer to
 * `val-sign-in`. The ref goes on the element.
 */
export function useValWebComponent(
  src: string,
  loadScript: (src: string) => Promise<void> = loadWebComponentScript,
) {
  const ref = useRef<HTMLElement>(null);

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
    const onSignIn = () => signIn();
    element.addEventListener("val-sign-in", onSignIn);
    return () => element.removeEventListener("val-sign-in", onSignIn);
  }, []);

  return ref;
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
