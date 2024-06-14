# Planned features

## i18n

Example:

```tsx
// file: ./blogs.val.ts

export const schema = s.array(
  s.i18n(s.object({ title: s.string(), text: s.richtext() }))
);

export default c.define("/blogs", schema, [
  {
    en_US: {
      title: "Title 1",
      text: c.richtext("Richtext 1"),
    },
    nb_NO: {
      title: "Tittel 1",
      text: c.richtext("Riktekst?"),
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

## oneOf

oneOf makes it possible to reference an item in an array of in another val module.

Example:

```ts
// file: ./employees.val.ts

export schema = s.array(s.object({ name: s.string() }));

export default c.define('/employees', schema, [{
  name: 'John Smith',
}]);

// file: ./contacts.val.ts

import employeesVal from './employees.val';

export schema = s.object({
  hr: s.oneOf(employeesVal),
});

export default c.define('/contacts', schema, {
  hr: employeesVal[0]
});


```

Missing infrastructure: need a change in how patches are applied for source files to handle selectors inside data.
