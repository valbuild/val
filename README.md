<p align="center">
  <h1 align="center">Val - super-charged hard-coded content</h1>
  <p align="center">
    ✨ <a href="https://app.val.build">https://app.val.build</a> ✨
    <br/>
    TypeScript-first schema validation with static type inference
  </p>
</p>

## Table of contents

- [Table of contents](#table-of-contents)
- [Introduction](#introduction)
- [Installation](#installation)
  - [Requirements](#requirements)
  - [From `npm` (Node/Bun)](#from-npm-nodebun)
- [Basic usage](#basic-usage)
- [Primitives](#primitives)

## One-liner

Val is a TypeScript-first CMS where content is defined in code built for React.

## Why another CMS

--- Story

We imagined the ideal way to handle content: for developers it is hard-coded.

You know how to hard-code data, it is type safe, you do not have to fetch it before rendering (it is "close"), you can branch, you can refactor, ....

But wait there is more: it is even better than hard-coded, we have zero-cost abstraction of i18n, there image hotpot and transcoding, rich text, ...

For editors: your content is best viewed in your app, they click and edit directly. Just give a preview link and they can edit.

With Val we have combined the 2 into an awesome CMS.

--- Feature-by-feature

With Val your content is code, but editable.

In Val your code is the one source of truth: both schema and content lives together in your code base.

No more queries that can fail, or content that is out of sync with your schema - you have your code, you have your content.

No more fetch logic in SSR components, if content is there.

No more complicated build steps to generate types from the weird-ass query language your current CMS is forcing to learn. You know TypeScript - you know Val.

Isomorphic content: when content model grows, you can make it remote - without losing typesafety or branchability.

No more "add-only" content models, where your content model keeps growing since you do not dare remove anything.

It is type-safe and refactorable, so you and your tools will know you when something is wrong and you can update it.

Contextual editing will make your editors love you.

Oh, and did we mention: local development requires no sign up.

## Installation

- Make sure you have TypeScript 4.9+, Next 13+ (other meta frameworks will come), React 18+ (other frontend frameworks will come)
- Install the packages:

```sh
npm install @valbuild/core @valbuild/react @valbuild/server
```

- Create your val.config.ts file:

```ts
// ./val.config.ts

import { initVal } from "@valbuild/core";

const { s, val } = initVal();

export { s, val };
```

- Update tsconfig.json: enable strict mode and include the Val JSX transformer :

```json
// ./tsconfig.json

{
  "compilerOptions": {
    ///...
    "strict": true,
    ///...
    "jsx": "react-jsx",
    "jsxImportSource": "@valbuild/react"
    //...
  }
  ///...
}
```

- Enable contextual editing: setup Val endpoints

```ts
// ./pages/api/val/[...val].ts

import { createRequestListener } from "@valbuild/server";
import { NextApiHandler } from "next";

const handler: NextApiHandler = createRequestListener("/api/val", {
  valConfigPath: "./val.config",
});

export default handler;

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
```

- Enable contextual editing: Use the Val provider in a top-level layout file:

```tsx
// ./app/layout.tsx

import { ValProvider } from "@valbuild/react";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/*
        <head /> will contain the components returned by the nearest parent
        head.tsx. Find out more at https://beta.nextjs.org/docs/api-reference/file-conventions/head
      */}
      <head />
      <body>
        <ValProvider host="/api/val">{children}</ValProvider>
      </body>
    </html>
  );
}
```

## Create your first Val content file

Content defined in Val is always defined `.val.{ts|js}` files.

They must export a default `val.content` where the first argument equals the path of the file relative to the `val.config.{js|ts}` file.

```ts
// ./app/example/blogs.val.ts

import { s, val } from "src/val.config";

export default val.content(
  "/app/example/blogs", // <- NOTE: this must be the same path as the file
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

## Use your content

```tsx
// /app/example/page.tsx

import { NextPage } from "next";
import { useVal } from "@valbuild/react";
import blogsVal from "./blogs.val";
import { val } from "val.config";

const Home: NextPage = () => {
  const blogs = useVal(blogsVal);
  return (
    <main>
      <article>
        {blogs.map((blog) => (
          <section key={val.key(blog)}>
            <h1>{blog.title}</h1>
            <p>{blog.text}</p>
          </section>
        ))}
      </article>
    </main>
  );
};

export default Home;
```

## Primitives

```ts
import { s } from "./val.config";

s.string(); // <- Schema<string>
s.number();
s.boolean();
```

## Optional

All schema types can be optional. An optional schema creates a union of the type and `null`.

```ts
import { s } from "./val.config";

s.string().optional(); // <- Schema<string | null>
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
s.image({ ext: ["webp"] });
```

### Initializing image content

TODO:

```ts

```

## Internalization

## Union

## One of references

# Selector
