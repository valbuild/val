/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { ValConfig } from "@valbuild/core";
import { ValThemeProvider, useTheme } from "./ValThemeProvider";
import { ThemeSettings } from "../hooks/themeSettings";

/**
 * Which mode the Studio opens in, when three different things have an opinion.
 *
 * The order is the whole of it: **the person, then the project, then the
 * config.** A `theme.mode` in `s.settings()` is a DEFAULT for someone who has
 * never chosen — the point of putting it in settings is that changing it should
 * not need a developer and a deploy — and it must never move the mode for an
 * editor who has flicked the switch.
 *
 * The trap this pins down is which storage says "the person chose". There are
 * two keys, and only one of them means that: `initSessionTheme` in
 * `@valbuild/next` writes the SESSION key from `config.defaultTheme` (or from
 * plain `"dark"`) on every load, so a value there says nothing about anyone's
 * choice. Reading it as a choice makes `theme.mode` dead for every project
 * that has a config default — which is every project the session key is
 * written for.
 */
const CONFIG: ValConfig = { project: "acme/site" };
const PERSONAL_KEY = "val-theme-acme/site";

function Probe() {
  const { theme, resolvedTheme, themeStyle } = useTheme();
  return (
    <>
      <span data-testid="theme">{theme ?? "unset"}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="accent">
        {themeStyle["--colors-brand-green-500"] ?? "none"}
      </span>
      <span data-testid="radius">{themeStyle["--radius"] ?? "none"}</span>
    </>
  );
}

/**
 * Render and read back in one call.
 *
 * Cleans up first, so a test can render several times to compare cases —
 * Testing Library only cleans up between tests, and a second render otherwise
 * leaves two probes in the document and every query becomes ambiguous.
 */
function renderProvider(
  theme: "dark" | "light" | null,
  settingsTheme?: Partial<ThemeSettings>,
) {
  cleanup();
  render(
    <ValThemeProvider
      theme={theme}
      setTheme={() => undefined}
      config={CONFIG}
      settingsTheme={{
        accent: null,
        radius: null,
        mode: null,
        logo: null,
        ...settingsTheme,
      }}
    >
      <Probe />
    </ValThemeProvider>,
  );
  return {
    theme: screen.getByTestId("theme").textContent,
    resolved: screen.getByTestId("resolved").textContent,
    accent: screen.getByTestId("accent").textContent,
    radius: screen.getByTestId("radius").textContent,
  };
}

describe("ValThemeProvider: which mode wins", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test("the project's default applies when nobody has chosen", () => {
    // `theme` here is what App.tsx worked out: the session key, or the config
    // default, or "dark". None of those is a choice.
    expect(renderProvider("dark", { mode: "light" }).resolved).toBe("light");
  });

  test("the person's own choice beats the project's default", () => {
    localStorage.setItem(PERSONAL_KEY, "dark");
    expect(renderProvider("dark", { mode: "light" }).resolved).toBe("dark");
  });

  test("the person's choice beats the project even in the other direction", () => {
    // Both directions, because a precedence bug that only shows one way round
    // reads as "light mode is broken" rather than as a precedence bug.
    localStorage.setItem(PERSONAL_KEY, "light");
    expect(renderProvider("light", { mode: "dark" }).resolved).toBe("light");
  });

  test("a session value is not a choice", () => {
    // The regression this exists for. `initSessionTheme` writes this key from
    // the config default on every load, so treating it as a choice would make
    // `theme.mode` do nothing for the projects that set a default.
    sessionStorage.setItem("val-theme", "dark");
    expect(renderProvider("dark", { mode: "light" }).resolved).toBe("light");
  });

  test("falls back to what the config worked out when the project says nothing", () => {
    expect(renderProvider("light").resolved).toBe("light");
  });

  test("resolves to a mode even when nothing at all has an answer", () => {
    // `resolvedTheme` is what gets stamped as `data-mode`, and the light
    // palette is the unqualified `:host, :root` block — so an unstamped root
    // renders light silently. It must never be null.
    const { theme, resolved } = renderProvider(null);
    expect(theme).toBe("unset");
    expect(resolved).toBe("dark");
  });

  test("a junk value in storage is not a choice", () => {
    localStorage.setItem(PERSONAL_KEY, "aubergine");
    expect(renderProvider("dark", { mode: "light" }).resolved).toBe("light");
  });
});

describe("ValThemeProvider: the project's theme as custom properties", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  test("a project with no theme pays for nothing", () => {
    const { accent, radius } = renderProvider("dark");
    expect(accent).toBe("none");
    expect(radius).toBe("none");
  });

  test("an accent becomes the whole generated ramp", () => {
    expect(renderProvider("dark", { accent: "#2563eb" }).accent).toMatch(
      /^#[0-9a-f]{6}$/,
    );
  });

  test("a radius step becomes its length", () => {
    // The named step is the source's; the length is the stylesheet's. The panel
    // never writes a length, so this mapping is the only place it happens.
    expect(renderProvider("dark", { radius: "tight" }).radius).toBe("0.25rem");
    expect(renderProvider("dark", { radius: "square" }).radius).toBe("0rem");
    expect(renderProvider("dark", { radius: "soft" }).radius).toBe("1rem");
  });

  test("the mode is independent of the accent", () => {
    // They are set in the same panel and are per different things: the mode is
    // one person's, the accent is the project's.
    const { resolved, accent } = renderProvider("dark", {
      accent: "#2563eb",
      mode: "light",
    });
    expect(resolved).toBe("light");
    expect(accent).not.toBe("none");
  });
});
