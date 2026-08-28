# Tailwind 4: what a migration actually costs

Written while bumping every dependency to its latest major. Tailwind was the one
that did not go, and this is what was measured before deciding that — so the
next person starts from findings rather than from guesses.

`packages/ui` stays on Tailwind 3 (moved to the latest 3.x, `^3.4.19`), and
`tailwind-merge` stays on 2.6.0 with it. tailwind-merge's own README is explicit:
"Supports Tailwind v4.0 up to v4.3 (if you use Tailwind v3, use tailwind-merge
v2.6.0)". Its major is pinned to Tailwind's — v3 knows v4's class scale, so on v3
classes it silently merges the wrong ones. The two move together or not at all.

## What turned out to be fine

**The Shadow DOM is not a problem.** This was the expected blocker and it is not
one. The Studio's stylesheet is loaded inside a shadow root, where `:root`
matches nothing, so a theme emitted to `:root` would be invisible. Tailwind 4.3
emits it to `:root, :host`:

```
$ npx @tailwindcss/cli@4.3.3 -i in.css -o out.css
$ grep -n '^\s*:root' out.css
5:  :root, :host {
```

**The JS config is fine.** `@config "../tailwind.config.js"` still works, and
Tailwind 4.3 compiles the real `packages/ui/spa/index.css` — the ~90 custom
color tokens, the keyframes, the `darkMode` selector and all 34 `@apply` sites —
through its own CLI with no errors:

```
$ cd packages/ui && npx @tailwindcss/cli@4.3.3 -i spa/index.css -o /tmp/out.css
≈ tailwindcss v4.3.3
Done in 281ms
```

So the config does not have to be rewritten as `@theme` up front. That can be a
later step.

## What actually blocks it

### 1. The build pipeline, not the CSS

Through vite's PostCSS pipeline the same file fails:

```
CssSyntaxError: [postcss] tailwindcss: spa/index.css:1:1:
  Cannot apply unknown utility class `text-2xl`
```

vite inlines `@import` before PostCSS runs, so `@tailwindcss/postcss` never sees
`@import "tailwindcss"`, comes up with no theme, and every `@apply` fails. The
fix is the documented one — use `@tailwindcss/vite` instead of the PostCSS
plugin — but `packages/ui` builds CSS through **four** entry points:
`vite.config.mts`, `server.vite.config.mts`, `spa.vite.config.mts`, and
`rollup.config.js` via `rollup-plugin-postcss`. The vite three take the vite
plugin; the rollup one still needs a PostCSS path. That mixed pipeline is the
first real piece of work.

### 2. Two utilities change meaning, measured

Comparing the v3 build against v4 output of the same source:

| class          | v3                                                    | v4                                                        | sites |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------- | ----- |
| `outline-none` | `outline: 2px solid transparent; outline-offset: 2px` | `outline-style: none`                                     | 65    |
| `shadow-sm`    | `0 1px 2px 0 rgb(0 0 0/.05)`                          | `0 1px 3px 0 rgb(0 0 0/.1), 0 1px 2px -1px rgb(0 0 0/.1)` | 12    |

`outline-none` is the one that matters. v3's version is the trick that keeps a
focus ring visible in Windows High Contrast Mode; v4's genuinely removes the
outline, and v4 renamed the old behaviour to `outline-hidden`. 65 sites is an
accessibility regression unless every one is rewritten.

`shadow-sm` in v4 is what v3 called plain `shadow`, so those 12 get visibly
heavier. v4 renamed v3's value to `shadow-xs`.

Both are mechanical codemods — `outline-none` → `outline-hidden`,
`shadow-sm` → `shadow-xs` — and both restore the v3 rendering exactly.

`rounded-sm` is **not** affected, despite being on every "v4 renamed this" list:
`tailwind.config.js` overrides `borderRadius`, so it resolves to
`calc(var(--radius) - 4px)` in both. Do not codemod it.

### 3. The z-index scale is a deliberate replacement

`theme.zIndex` in `tailwind.config.js` is a top-level key, not under `extend`,
so it _replaces_ the default scale. That is on purpose, and the comment above it
records why: `z-50` on the rich text toolbar put it over the shell's Pages
panel, and `z-[60]` on a node view put it over that. The named scale
(`hover`/`window`/`full`/`overlay`) exists so raw numbers do not work.

In v4 the equivalent is `@theme` with the defaults reset to `initial`. Getting
that wrong quietly re-enables `z-10` … `z-50` everywhere and undoes the fix. The
same applies to the `container` and `fontFamily` replacements.

### 4. Nothing in CI would catch any of it

```
$ grep -rc "toHaveScreenshot" e2e/ | grep -v ':0'
(no output)
```

There is no visual regression coverage. The 21 e2e specs assert behaviour and
values — `toHaveValue`, `toContain` — not appearance. The smoke suite renders the
Studio in Chromium and would stay green through every change above. The
stylesheet also grows 107 KB → 161 KB, which wants a look on its own.

## Suggested order

1. Land `@tailwindcss/vite` across the three vite configs and sort out the
   rollup/`rollup-plugin-postcss` path. Nothing else can be verified until the
   build runs.
2. Codemod `outline-none` → `outline-hidden` and `shadow-sm` → `shadow-xs`.
   Leave `rounded-sm` alone.
3. Re-express the `zIndex`, `container` and `fontFamily` replacements as
   `@theme` with `initial` resets, and check `z-10`/`z-50` do **not** resolve
   afterwards.
4. Bump `tailwind-merge` to 3 in the same commit — never separately.
5. Diff the built stylesheet against the v3 one and have someone open the Studio
   in both themes. Adding a few `toHaveScreenshot` specs first would make this
   step, and every future one, much cheaper.
