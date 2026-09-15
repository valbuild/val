---
"@valbuild/core": patch
"@valbuild/ui": patch
---

`.preview()` now names a value wherever the Studio shows it, including a module's own root

Wherever the Studio shows a piece of content to a human it has to answer three
questions: what is this called, what is it, what does it look like. Every
surface answered them itself, out of the path, and they disagreed — the same
record entry read `blog1` in the heading, "Blog 1" in the scope trail and
`/blogs/blog1` in the sitemap. They now give one answer, and it is the one you
wrote:

```ts
s.record(
  s.object({ title: s.string(), author: s.string(), cover: s.image() }),
).preview((blog) => ({
  title: blog.title,
  subtitle: blog.author,
  image: blog.cover,
}));
```

That title, subtitle and image are what the heading, list rows, search hits,
cards and chosen references show. Nothing is required: a project with no
`.preview()` reads exactly as it did — the route, the key, `#3`, or the
prettified file name — so this is somewhere to improve from rather than
something to adopt.

**`.preview()` on a module's own schema now works.** It was accepted and never
run: a preview was only ever reified by a CONTAINER for its rows, and a module
root has no container. So `c.define("/content/authors.val.ts", s.record(…)
.preview(…), …)` can name the module itself — "Forfattere" rather than
`authors.val.ts` — and the same is true of a field of an object.

**A page's URL is carried separately from its title.** A route is not a worse
name for a page, it is the page's identity: two drafts both titled "Launch" are
told apart by `/blog/launch-2026` and by nothing else. Title a page with
`.preview()` and its route moves to the line under the heading rather than
disappearing.

Two things a preview is deliberately NOT used for, because a preview is a
closure over source and so changes as an editor types:

- The breadcrumb, the Explorer and the Pages tree stay path segments. A trail
  of titles names three things and locates none of them. The one exception is a
  page, whose trail is its ROUTE instead of the file it is stored in — nobody
  reaches a page through the file.
- Help text. `.describe()` is input help and is shown where a field or a key is
  being ENTERED; a record key's description no longer appears in the heading,
  where the key cannot be edited, and appears in every form that asks for one.

Also fixed: a just-uploaded image stayed blank until save in list rows, headings
and reference dropdowns, which built the URL of the published file rather than
the pending patch's.
