---
"@valbuild/ui": patch
---

Finding out where a route is linked from is no longer slow on a large project.

The scan walked the full source tree of every module in the project looking for
`s.route()` fields, including the modules whose schema has no route field in it
anywhere — which on a real project is most of them. It now asks the schema
first, and only walks the source of a module that could actually hold a
reference.

Measured on a synthetic project of 41 modules and 4.5 MB of source: 18.2 ms per
scan before, 0.10 ms after. The scan runs once per route key, so anything asking
about several routes at once saves that much again per route.
