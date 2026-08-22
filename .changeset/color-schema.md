---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/server": minor
"@valbuild/react": minor
"@valbuild/ui": minor
---

Add `s.color()` for picking colors. Colors are stored as CSS color strings so they can be used directly in a `style` attribute or set as a CSS custom property.

The notation is chosen with the `format` option — `"hsl"` (the default), `"hex"`, `"rgb"` or `"oklch"`:

```ts
s.color(); // hsl(217.22 91.22% 59.8%)
s.color({ format: "hex" }); // #3b82f6
s.color({ format: "rgb" }); // rgb(59 130 246)
s.color({ format: "oklch" }); // oklch(0.6231 0.188 259.81)
s.color({ format: "hsl", alpha: true }); // hsl(217.22 91.22% 59.8% / 0.5)
```

Validation accepts both the modern and the legacy syntax of the configured format (`hsl(0 100% 50%)` and `hsl(0, 100%, 50%)`, `#f00` and `#ff0000`), and reports the equivalent value in the right notation when a color is written in another format. An alpha channel is a validation error unless `alpha: true` is set.

In the Val editor the field is a native `<input type="color">` swatch — so the OS color picker is used — next to a text input that accepts any CSS color and converts it to the configured format.
