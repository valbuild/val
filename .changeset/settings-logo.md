---
"@valbuild/core": minor
"@valbuild/ui": minor
---

A project can put its own logo in Val Studio.

`s.settings()`'s `theme` section takes a `logo`, uploaded from **Settings →
Appearance**. It replaces Val's mark at the top of the left rail, and beside the
menu button below the desktop breakpoint — the two slots that say which
workspace you are in.

```ts
export default c.define("/settings.val.ts", s.settings(), {
  theme: {
    logo: {
      path: "/public/val/brand/mark_a1b2c.png",
      width: 512,
      height: 512,
      mimeType: "image/png",
    },
  },
});
```

It is an ordinary image field, so it comes with the upload, the alt text and
everything else `s.image()` has, and the file lands in `/public/val/brand` so it
does not sit in the middle of your content's media. A draft logo shows
immediately and publishes with the rest of your changes.

Two things are deliberate:

- **A square-ish mark, not a wordmark.** The slot is 32px wide. A wide image is
  fitted into it rather than cropped, so all of it is there and none of it is
  large.
- **Val's mark stays on the launcher that floats on your own site.** In the
  Studio the mark labels the workspace, so your logo belongs there. On your own
  page it labels the tool — it is the button that opens Val — and your logo
  floating over your own website says nothing.
