---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/tanstack": patch
---

The demo has a script: `<ValApp demo={{ tours, audiences }}>`. Instead of a tour that opens by itself, the demo card asks "What brings you here?" and lists short tours for the answer, each ticked off once done. `/val?tour=<id>` starts one from a link.

A tour can start on a page of its own (`start`). A step can ask for a new page (`moveOn: { newPage }`), write any value or add one (`moveOn: { edit, value, add }`), and show the code behind what it is about (`code`).
