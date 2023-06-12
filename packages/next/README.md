<p align="center">
  <h1 align="center">Val</h1>
  <p align="center">
    ✨ <a href="https://app.val.build">https://app.val.build</a> ✨
    <br/>
    hard-coded content - super-charged
  </p>
</p>

# 🐉 HERE BE DRAGONS 🐉

Val is PRE-ALPHA - MOST features are broken and in state of flux.

This is released only for **INTERNAL** **TESTING** PURPOSES.

## Table of contents

- [Table of contents](#table-of-contents)
- [Introduction](#introduction)
- [Installation](#installation)
- [Getting started](#getting-started)
- [Concepts](#concepts)
- [String](#string)
- [Number](#number)
- [Boolean](#boolean)
- [Optional](#optional)
- [Array](#array)
- [Object](#object)
- [Rich text](#richtext)
- [Image](#image)
- [Internalization](#internalization)
- [Union](#union)
- [One-of references](#one-of-references)
- [Remote](#remote)
- [Selector](#selector)

## Introduction

Val treats your content as code, but it remains fully editable.

Val is built on top of TypeScript and Git, letting you use types, branches, version control (even rollbacks!) seamlessly.

- Val is **TypeSafe**: being TypeScript-first means you see errors as you type. In addition you can **refactor**, find references and auto-complete content - just as if it was hard-coded. Safety means no more "add-only" content models, where your content model continues to expand because you hesitate to remove anything.

- Version **control**: content is tied to commits, which means you can use branches and reverts just as you would normally do.

- Val is **isomorphic**: if your content scales beyond your code base, Val lets you easily make it remote. Just add `.remote()` to your schema and Val will host your content - your components stays the same. Remote content are handled using immutable references, so remote content are tied to Git commits - rollbacks, branches works as before.

- Contextual editing: Val is built from the ground up to support contextual editing. Editors can see Val content in the context of the app, and make edits directly there.

- Full CMS: even hard-coded content has its drawbacks: i18n, images, rich text - Val supports all of these.

- No signup required: **your** content is yours. Local development requires no sign ups and is free. When you are ready and editors needs access, you can sign up and without any changes to your code base. Head over to [https://app.val.build](https://app.val.build) to get started 🚀.

## Installation

- Make sure you have TypeScript 4.9+, Next 12+ (other meta frameworks will come), React 18+ (other frontend frameworks will come)
- Install the packages:

```sh
npm install @valbuild/next
```

- Create your val.config.ts file. NOTE: this file should be in the same directory as `tsconfig.json`:

```ts
// ./val.config.ts

import { initVal } from "@valbuild/next";

const { s, val } = initVal();

export { s, val };
```

- Enable contextual editing: setup Val endpoints

```ts
// ./src/pages/api/val/[...val].ts

import { valEditHandler } from "../../../../val.config";
import { NextApiHandler } from "next";

const handler: NextApiHandler = valEditHandler

export default handler;

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
```

- Enable contextual editing: Use the Val provider in the \_app file:

```tsx
// ./src/pages/_app.tsx

import { ValProvider } from "@valbuild/react";
import type { AppProps } from "next/app";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ValProvider host="/api/val">
      <Component {...pageProps} />
    </ValProvider>
  );
}

export default MyApp;
```

## Getting started

### Create your first Val content file

Content defined in Val is always defined `.val.{ts|js}` files.

They must export a default `val.content` where the first argument equals the path of the file relative to the `val.config.{js|ts}` file.

```ts
// ./src/content/example/blogs.val.ts

import { s, val } from "../../../val.config";

export default val.content(
  "/src/content/example/blogs", // <- NOTE: this must be the same path as the file
  s.array(s.object({ title: s.string(), text: s.string() })),
  [
    {
      title: "Title 1",
      text: "Text 1",
    },
    {
      title: "Title 2",
      text: "Text 2",
    },
  ]
);
```

### Use your content

```tsx
// ./src/pages/example/index.tsx

import { NextPage } from "next";
import { useVal } from "@valbuild/react";
import blogsVal from "@/content/example/blogs.val";

const Blog: NextPage = () => {
  const blog = useVal(blogsVal[0]);
  return (
    <main>
      <article>
        <section>
          <h1>{blog.title}</h1>
          <p>{blog.text}</p>
        </section>
      </article>
    </main>
  );
};

export default Blog;
```

## Concepts

`.val.{ts|js}` files **MUST** have a default export which is a ValModule. A ValModule is a special type of [Selector](#selectors). Selectors makes it possible to select a subset of content from a ValModule or a another Selector.

Selectors can be turned to Val types using `useVal` or `fetchVal`.

### .val files

`.val.{ts|js}` files are the files in which you store your content.

They are evaluated when the content is run, therefore they have a specific set of requirements. They must have a default export that is `val.content`, they must have a `export const schema` with the Schema and they CANNOT import anything other than `val.config` and `@valbuild/core`.

Example:

```ts
import { s, val } from "../val.config";

export const schema = t.string();

export default val.content(
  "/file/path/relative/to/val/config",
  schema,
  "My string content"
);
```

NOTE: IN THE FUTURE, they will be validated by the eslint-plugin.

## String

```ts
import { s } from "./val.config";

s.string(); // <- Schema<string>
```

### String selectors

See [Selectors](#selector) for more info.

### String `.eq`

```ts
useVal(stringVal.eq("")); // <- Val<boolean>
```

## Number

```ts
import { s } from "./val.config";

s.number(); // <- Schema<number>
```

### Number selectors

See [Selectors](#selector) for more info.

### Number `.eq`

```ts
useVal(numberVal.eq(2)); // <- Val<boolean>
```

## Boolean

```ts
import { s } from "./val.config";

s.boolean(); // <- Schema<boolean>
```

### Boolean selectors

See [Selectors](#selector) for more info.

### Boolean `.eq`

```ts
useVal(booleanVal.eq(true)); // <- Val<boolean>
```

## Optional

All schema types can be optional. An optional schema creates a union of the type and `null`.

```ts
import { s } from "./val.config";

s.string().optional(); // <- Schema<string | null>
```

### Selectors

### Accessing the underlying type: `.andThen`

To use and optional val, you can use the [.andThen](#andthen) selector.

## Array

```ts
s.array(t.string());
```

### Selecting arrays

### `.filter`

TODO: text

```ts
useVal(myArray.filter((item) => item.title.eq("Title 1")));
```

### `.map`

TODO:

```ts
useVal(myArray.map((item) => ({ test: item.title })));
```

## Object

```ts
s.object({
  myProperty: s.string(),
});
```

### Selecting objects

You can select Selector objects almost as if they were normal objects. The exception is that you cannot use the spread (`...`) operator.

Example:

```ts
useVal({ foo: myObjectVal.hello });
```

## RichText

### RichText Schema

```ts
import { s } from "./val.config";

s.richtext();
```

### Initializing RichText content

To initialize some text content using a RichText schema, you can use follow the example below:

```ts
import { s, val } from "./val.config";

// TODO: need some other way of doing this:
export default val.content("/example/richtext.ts", s.richtext(), {
  children: [
    {
      type: "paragraph",
      version: 1,
      indent: 0,
      direction: "ltr",
      format: "",
      children: [
        {
          type: "text",
          version: 1,
          mode: "normal",
          format: 0,
          detail: 0,
          style: "",
          text: "TODO: update me",
        },
      ],
    },
  ],
  direction: "ltr",
  format: "",
  indent: 0,
  type: "root",
  version: 1,
});
```

### Render RichText

You can use the `ValRichText` component to render content.

```tsx
"use client";
import { useVal, ValRichText } from "@valbuild/react";
import richtextVal from "./richtext";

export default function Page() {
  const richtext = useVal(richtextVal);
  return <ValRichText>{richtext}</ValRichText>;
}
```

## Image

### Schema

```ts
s.image();
```

### Initializing image content

Local images must be stored under the `.public` folder.

```ts
import { s, val } from "../val.config";

export const schema = s.image();

export default val.content("/image", schema, val.file("/public/myfile.jpg"));
```

NOTE: This will not validate, since images requires `width`, `height` and a `sha256` checksum. You can fix this validation in the UI by opening the image and clicking the Fix button.

### Using images in components

Images are transformed to object that have a `url` property which can be used to render them.

Example:

```tsx
// in a Functional Component
const image = useVal(imageVal);

return <img src={image.url} />;
```

## Internalization

**NOTE**: WORKS ONLY ON THE TYPE LEVEL

To enable i18n, you must update your Val with the locales you want to enforce.

Example:

```ts
// ./val.config.ts

import { initVal } from "@valbuild/core";

const { s, val } = initVal({
  locales: {
    required: ["en_US", "fr_FR"],
    fallback: "en_US",
  },
});

export { s, val };
```

## Union

**NOTE**: WORKS ONLY ON THE TYPE LEVEL

TODO: fill in.

```ts
s.union(
  "type",
  s.object({ type: s.literal("type1"), bar: s.string() }),
  s.object({ type: s.literal("type2"), foo: s.number() })
);
```

### Selecting unions

### `.fold`

TODO: description

```ts
useVal(myUnionVal.fold("type")({

})
```

## One of references

**NOTE**: Currently not possible to change from UI

```ts

```

# Remote

**NOTE**: WORKS ONLY ON THE TYPE LEVEL

All schemas can be converted into `.remote`.

TODO: add description.

Example:

```ts
export const schema = s.object({ stuff: s.string() });

export default val.content("/remote/example", schema, val.remote("REFERENCE"));
```

## Selector

To select parts of a your content you should use Selectors.
If you make the content `.remote`

### `.andThen`

All selectors can use `andThen` method which is similar to the `&&` operator. You can use this to only do operations on optionals that are defined. NOTE: only TRUTHY arguments are passed in to `andThen` (i.e. the empty string, `''` is NOT truthy).

Given the example schema:

```ts
// ./maybeArray.val.ts
//...

export const schema = t.array(t.string()).optional();

//...
```

```ts
import maybeArrayVal from "./maybeArray.val";
useVal(maybeArrayVal.andThen((array) => array.filter((v) => v.eq("foo"))));
```
