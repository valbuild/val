# Planned features

## i18n

Example:

```tsx
// file: ./blogs.val.ts

export const schema = s.array(
  s.i18n(s.object({ title: s.string(), text: s.richtext() }))
);

export default val.content("/blogs", schema, [
  {
    en_US: {
      title: "Title 1",
      text: val.richtext("Richtext 1"),
    },
    nb_NO: {
      title: "Tittel 1",
      text: val.richtext("Riktekst?"),
    },
  },
]);

// file: ./components/ServerComponent.ts

import blogsVal from "./blogs.val";

export async function ServerComponent({ index }: { index: number }) {
  const blogs = await fetchVal(blogVal, getLocale());

  // NOTE: automatically resolves the locale
  const title = blogs[index].title; // is a string
  return <div>{title}</div>;
}
```

Missing infrastructure: none in particular.

## remote

Remote makes it possible to move content to cloud storage (and back again). It uses immutable references, so local work, branches still works.

Example:

```tsx
// file: ./blogs.val.ts

export const schema = s
  .array(s.object({ title: s.string(), text: s.richtext() }))
  .remote();

export default val.content(
  "/blogs",
  schema,
  val.remote("4ba7c33b32a60be06b1b26dff8cc5d8d967660ab") // a change in content, will result in a new reference
);

// file: ./components/ServerComponent.ts

import blogsVal from "./blogs.val";

export async function ServerComponent({ index }: { index: number }) {
  const blog = await fetchVal(
    blogVal[index] // only fetch the blog at index
  );
  const title = blog.title;
  return <div>{title}</div>;
}
```

Missing infrastructure: cloud support, patch support, selectors proxy needs to be able to switch between remote and source (see selectors/future), editor plugin to improve DX (refactors, ...)?

## oneOf

oneOf makes it possible to reference an item in an array of in another val module.

Example:

```ts
// file: ./employees.val.ts

export schema = s.array(s.object({ name: s.string() }));

export default val.content('/employees', schema, [{
  name: 'John Smith',
}]);

// file: ./contacts.val.ts

import employeesVal from './employees.val';

export schema = s.object({
  hr: s.oneOf(employeesVal),
});

export default val.content('/contacts', schema, {
  hr: employeesVal[0]
});


```

Missing infrastructure: need a change in how patches are applied for source files to handle selectors inside data.
