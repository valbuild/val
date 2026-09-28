---
"@valbuild/ui": patch
---

URLs in rich text become links without the link dialog.

- **Paste** a URL, or text with several in it, and each becomes a link. A chip under the paste says so, and **Keep as text** undoes just the linking (⌘Z still undoes the whole paste). Pasting one URL over selected text links the selection.
- **Type** a URL and it becomes a link when you type the space or press Enter after it.
- **Ctrl/⌘+K** links the URL the cursor is on. On a link or a selection, it opens the link editor.
- A bar under the field lists URLs that are still plain text: **Link all**, or **Review** to choose which ones.

A URL on the site itself becomes an internal link: pasting `https://blank.no/jobb` into blank.no's Studio gives `/jobb`. If there is no such page, it is not linked. It is highlighted as an error, both in the text and in the bar. Links that already point at the site's full address can be fixed the same way.

In a field that can only link to the project's pages (`s.richtext({ a: true })`), a URL that isn't one of those pages is never linked, because the field would drop that link. The bar says how many such URLs there are.

The site is recognised by the address the Studio is open on. So on a local dev server, URLs copied from production are treated as external.
