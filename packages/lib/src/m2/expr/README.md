# Visp

Visp (as in Val Lisp or whisk in Norwegian) is a Lisp used to serialize Val `Selector`s.

It is an INTERNAL language - it is NOT designed to be used by end-users.
This document is architectural overview for this INTERNAL language - it is documentation for developers working on Val.

Visp exists since Val clients must be able to execute remote `Selector`s.
See the docs for remote `Schema`s for more about this.

The design goals are as follows:

- evaluate to `Val` objects
- easy to parse and serialize
- easy to evaluate in JavaScript
- readable by Vals developers (for internal debugging)
- stable language semantics to avoid breaking changes as Visp is part of the (internal) API versioning
- does not support more functionality than what is required to serialize `Selector`s

The non-goals are:

- Visp does not need to be convenient to write - `Selector`s are used to write it
- Visp does not need to be easily understandable by end-users of Val

## Syntax

Visp is a Lisp which only can evaluate one expression at a time.

Read more about how it works in sections that follows.

### Property access

```visp
('title' foo)
```

corresponds to:

```js
foo['title']
```

There are no numbers in Visp, so arrays are indexed in the same way:

```visp
('0' foo)
```

corresponds to:

```js
foo['0'] // same as foo[0]
```

### Function calls

Function calls are similar to property access, but with arguments separated by whitespace:

```visp
(fnname foo arg1 arg2)
```

corresponds to:

```js
foo['fnname'](arg1, arg2) // same as foo.fname(arg1, arg2)
```

#### Higher order functions

Higher order functions must be prefixed with the `!` character.
Arguments can be accessed using the `@` character. The `@` must be suffixed with indexes, e.g. `@[0,0]`, the first one corresponding to the stack depth and the second corresponds to index of the argument list.

```visp
!(map foo @[0,0])
```

corresponds to:

```js
foo.map(v => v)
```

Here we access the second argument of a function:

```visp
!(map foo @[0,1])
```

corresponds to:

```js
foo.map((_,i) => i)
```

This example shows how higher functions and arguments can be nested:

```visp
!(map foo !(map @[0,0] (slice @[1,0] @[0,1])))
```

corresponds to:

```js
foo.map((v, i) => v.map((j) => j.slice(i)))
```

### Literals

Visp only supports string literals.

Example:

```visp
'foo'
```

corresponds to:

```js
'foo'
```

### String templates

Val has support for string templates similar to JavaScript.
They are denoted using single quotes `'` (as string literal), but can inject expressions using  `${}`.

Example:

```visp
'foo ${('title' obj)} bar'
```

corresponds to:

```js
`foo ${obj['title']} bar`
```

### Special symbols

### `()`

The `()` symbol evaluates to `undefined`.

#### `@`

This symbol can be used to access arguments in [higher order functions](#higher-order-functions).

### `!`

This is a prefix to a [higher order function](#higher-order-functions).

### val

The `val` symbol is used to access data from a Val module.

Example:

```visp
(val '/foo/bar`)
```

Returns the `Source` of a Val module of id `/foo/bar`.

### json

The `json` symbol is used to parse json strings.

Example:

```visp
(json '{"foo": "bar"}')
```

To create numbers, lists etc, the `json` symbol can be used.

It is also possible to use `json` with string templates:

```visp
(json '{ "foo": ${('title' obj)} }')
```

corresponds to:

```js
JSON.parse(`{ "foo": ${obj['title']} }`)
```

### More

More examples can be found in the [eval.test](eval.test.ts)
