# Shared types and utils

This package contains internal Val types and utils that are shared between other packages.

Since Val has many runtimes (node, browser, QuickJS) and is bundled in different ways and executed different modes (client, SSR, RSC), we need to be careful about how code is bundled. This package gives us an extra place to put code that is shared between all platforms, but that can be run in all runtimes and bundlers.

## What is goes into this package?

Generally speaking, code that are shared between other packages belongs in this package. Specifically:

- Types and utility functions that does **NOT** belong in core because they:
  1. is not required to execute Val files; or
  1. have dependency on a lib
- Types and utility functions that does **NOT** semantically belong in any other package. Examples:
  1. parser tools
  1. API layer

See the rules to what does NOT belong in this package below.

## What **DOES NOT** go into this package?

- Any function / type that depends on a UI framework, even transitively (React, Lexical, NextJS, Vite...).
- Any function that cannot execute both on server-side and client-side.
