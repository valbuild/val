# VISP

VISP (as in Val-lisp) is a lisp that is designed to be the serialized representation of Val `Selector`s.
Val requires serialized `Selector`s since Val has remote selectors.

The design goals are as follows:

- easy to parse and serialize
- easy to evaluate in JavaScript
- more concise than an AST, therefore more readable
- based on a standard language (lisp) so it does not seem too exotic for somebody who knows lisp / functional programming

The non-goals are:

- not adapted to be written by humans
- easily understandable by end-users of Val. VISP code is only derived from the `Selector` DSL.
- include more functionality than what is required to serialize `Selector`s

## Syntax

VISP is a lisp which only can evaluate one expression at a time.

Read more about how it works in sections that follows.

### Property access

```visp
('title' foo)
```

corresponds to:

```js
foo['title']
```

There are no numbers in VISP, so arrays are indexed in the same way:

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
Arguments can be accessed using the `@` character. The `@` must be suffixed with indexes, eg `@[0,0]`, the first one corresponding to the stack depth and the second corresponds to index of the argument list.

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

VISP only supports string literals.

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
They are denoted using single quotes `'` (as normal strings), but can inject expressions using  `${}`.

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

The `json` symbol is used to parse json.

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
{ "foo": obj['title' ] }
```

### More

More examples can be found in the [eval.test](eval.test.ts)
