---
"@valbuild/tanstack": minor
"@valbuild/core": minor
---

`ValImage` in `@valbuild/tanstack` now takes the props `next/image` takes, and published remote images are resized for the screen they are shown on.

```tsx
<ValImage
  src={page.hero.image}
  sizes="(min-width: 1024px) 50vw, 100vw"
  priority
  placeholder="blur"
/>
```

- **Resized remote images.** A published `s.image().remote()` (or any image with `files: { remote: true }`) gets a `srcset`, and the host that serves it — Val's platform on Cloudflare, or `remote.val.build` — answers each width with the image scaled down in AVIF or WebP. Pass `sizes` for an image CSS shows smaller than it is; without it the `srcset` is 1x and 2x the rendered width.
- **`next/image`'s props:** `sizes`, `quality`, `fill`, `priority` / `preload`, `placeholder` / `blurDataURL`, `loader`, `unoptimized` and `overrideSrc`.
- **`getValImageProps`**, the counterpart of `next/image`'s `getImageProps`, for a `<picture>`.
- **Lazy by default:** `loading="lazy"` and `decoding="async"`, as `next/image` does. Pass `priority` for the largest image above the fold.
- Given only a `width` or a `height`, the other now follows the image's aspect ratio.

Local images and drafts are served as before. A `loader` of your own is used for every image, local ones included.
