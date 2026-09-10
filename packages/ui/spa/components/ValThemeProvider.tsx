import React, {
  useContext,
  useCallback,
  useMemo,
  useState,
  CSSProperties,
} from "react";
import {
  themeCustomProperties,
  VAL_THEME_SESSION_STORAGE_KEY,
} from "@valbuild/shared/internal";
import { THEME_RADIUS_LENGTHS, ValConfig } from "@valbuild/core";
import { NO_THEME_SETTINGS, ThemeSettings } from "../hooks/themeSettings";

export type Themes = "dark" | "light";

type ValThemeContextValue = {
  /**
   * The mode as the person's own storage and `val.config.ts` have it.
   *
   * `null` means neither has an answer. Kept as it was rather than resolved,
   * because callers use it to tell "nobody has said" from "somebody said dark".
   * To STAMP a mode, use {@link ValThemeContextValue.resolvedTheme} — an
   * unstamped root silently renders light, since the light palette is the
   * unqualified `:host, :root` block.
   */
  theme: Themes | null;
  /**
   * The mode to actually draw in: the person's choice, else the project's
   * default from `s.settings()`, else what `theme` says.
   */
  resolvedTheme: Themes;
  setTheme: (theme: Themes | null) => void;
  /**
   * The project's theme, as custom properties for a `style` prop.
   *
   * Empty for a project with no theme, which is what makes the feature free
   * when it is not used. Put it on every element that stamps `data-mode` — see
   * {@link ValThemeProvider}.
   *
   * `CSSProperties` carries custom properties without an assertion because
   * `spa/types/cssCustomProperties.d.ts` augments it with a `--*` index
   * signature — which is what makes reading one back (`themeStyle["--radius"]`,
   * as the tests do) type-check at all.
   */
  themeStyle: CSSProperties;
};

const ValThemeContext = React.createContext<ValThemeContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          "Cannot use ValThemeContext outside of ValThemeProvider",
        );
      },
    },
  ) as ValThemeContextValue,
);

/** Where the person's OWN choice of mode is kept, and nothing else. */
function personalThemeKey(config: ValConfig | undefined): string {
  return "val-theme-" + (config?.project || "unknown");
}

/**
 * The mode this person picked, or `null` if they never have.
 *
 * Local storage and not the session key, and the difference decides the whole
 * precedence order: `initSessionTheme` in `@valbuild/next` writes the SESSION
 * key from `config.defaultTheme` (or from plain `"dark"`), so a value there
 * says nothing about what anyone chose. This key is written in exactly one
 * place — `setTheme` below, when the switch is flicked.
 */
function readPersonalTheme(config: ValConfig | undefined): Themes | null {
  try {
    const stored = localStorage.getItem(personalThemeKey(config));
    if (stored === "dark" || stored === "light") {
      return stored;
    }
  } catch {
    // Storage can throw outright in a private window or with site data
    // blocked. Nobody chose, as far as we can tell.
  }
  return null;
}

/**
 * The Studio's theme: which mode it is in, and what the project has restyled.
 *
 * Two different things, deliberately in one place, because they end up on the
 * same element. **The theme travels with `data-mode`:** every element that
 * stamps that attribute also needs `themeStyle`, or the subtree under it draws
 * Val's green inside a themed Studio. Today that is `Shell`,
 * `ValPortalProvider` (so portalled dropdowns and dialogs do not fall out of
 * the theme) and `ValOverlay`.
 *
 * The two halves are per-DIFFERENT-things and that is worth keeping straight:
 * the mode is one person's, on one machine, and lives in their browser storage;
 * the accent and the corner radius are the project's, live in `s.settings()`,
 * are edited as a draft and published like any other content.
 */
export function ValThemeProvider({
  children,
  theme,
  setTheme,
  config,
  settingsTheme = NO_THEME_SETTINGS,
}: {
  children: React.ReactNode;
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
  config: ValConfig | undefined;
  /**
   * The project's `theme` section. Absent in Storybook and in the tests, which
   * is the same as a project that has not set one.
   */
  settingsTheme?: ThemeSettings;
}) {
  /**
   * Whether this person has chosen a mode, as opposed to being shown a default.
   *
   * State rather than a read on every render: it changes in exactly one place
   * (below), so tracking it is both cheaper and honest about when it moves.
   */
  const [personalTheme, setPersonalTheme] = useState<Themes | null>(() =>
    readPersonalTheme(config),
  );
  const wrappedSetTheme = useCallback(
    (newTheme: Themes | null) => {
      if (newTheme === "dark" || newTheme === "light") {
        try {
          sessionStorage.setItem(VAL_THEME_SESSION_STORAGE_KEY, newTheme);
          localStorage.setItem(personalThemeKey(config), newTheme);
        } catch (e) {
          console.error("Error setting theme in storage", e);
        }
        setPersonalTheme(newTheme);
        setTheme(newTheme);
      } else if (newTheme === null) {
        try {
          sessionStorage.removeItem(VAL_THEME_SESSION_STORAGE_KEY);
          localStorage.removeItem(personalThemeKey(config));
        } catch (e) {
          console.error("Error removing theme from storage", e);
        }
        // Back to undecided, so the project's default applies again.
        setPersonalTheme(null);
        setTheme(null);
      } else {
        console.warn(`Cannot set invalid theme: ${newTheme}`);
      }
    },
    [setTheme, config],
  );
  /**
   * Memoised on the PRIMITIVES rather than on `settingsTheme`.
   *
   * `useThemeSettingsOf` rebuilds its object whenever any module's source
   * changes — which is every keystroke in the editor — and this object goes on
   * a `style` prop at the root of the whole app. Keying on the two fields that
   * matter means a new object only when the theme itself moves. See
   * `architecture/stores.md` on why reference stability is load-bearing here.
   */
  const accent = settingsTheme.accent;
  const radius = settingsTheme.radius;
  const themeStyle = useMemo<CSSProperties>(
    () =>
      themeCustomProperties({
        accent,
        radius: radius === null ? null : THEME_RADIUS_LENGTHS[radius],
      }),
    [accent, radius],
  );
  const value = useMemo<ValThemeContextValue>(
    () => ({
      theme,
      // The person's choice wins, then the project's default, then whatever the
      // config and the "dark" fallback already worked out. `theme` is only null
      // when nothing at all has an answer, and the light palette is what an
      // unstamped root renders — so this must never be null.
      resolvedTheme: personalTheme ?? settingsTheme.mode ?? theme ?? "dark",
      setTheme: wrappedSetTheme,
      themeStyle,
    }),
    [theme, personalTheme, settingsTheme.mode, wrappedSetTheme, themeStyle],
  );

  return (
    <ValThemeContext.Provider value={value}>
      {children}
    </ValThemeContext.Provider>
  );
}

export function useTheme() {
  const { theme, resolvedTheme, setTheme, themeStyle } =
    useContext(ValThemeContext);
  return { theme, resolvedTheme, setTheme, themeStyle };
}
