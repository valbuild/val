---
"@valbuild/core": minor
"@valbuild/shared": patch
"@valbuild/ui": patch
---

New `s.int()` for whole numbers, `.step()` on `s.int()` and `s.number()`, and a slider for both:

```ts
s.object({
  columns: s.int().min(1).max(6),
  opacity: s
    .int()
    .min(0)
    .max(100)
    .step(5)
    .render({ as: "slider", min: 0, max: 100 }),
  lineHeight: s.number().render({ as: "slider", min: 1, max: 2, step: 0.1 }),
});
```

- `.min()`, `.max()` and `.step()` are rules the validator checks. A step is counted from `min`, or from 0 when there is none.
- `.render({ as: "slider", min, max, step? })` is how the field is edited: a slider, with a box beside it for typing an exact value. `min` and `max` are required. The slider's step defaults to the schema's `.step()`, then to 1.
- The slider can only produce values the schema accepts. A slider outside `.min()`/`.max()`, with a step that is not a multiple of `.step()`, or with decimals on an `s.int()` throws where the schema is defined.
- A value outside the slider's range is still valid content. The field says it is out of the slider's reach and offers "Set to" the nearest stop. A value that breaks a rule offers "Round to" the nearest allowed value.
- Fixed: `.min(0)` and `.max(0)` on `s.number()` were ignored.
- A new item of a number schema starts at the nearest allowed value instead of `0`, so `s.int().min(1)` starts at 1.
