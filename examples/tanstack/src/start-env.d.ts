/**
 * Pulls TanStack Start's type augmentations into the program.
 *
 * `server: { handlers }` on `createFileRoute` — what `src/routes/api/val.$.ts`
 * mounts the Val API with — is added by `@tanstack/start-client-core` as a
 * `declare module` augmentation of `@tanstack/router-core`. An augmentation
 * only applies when the file carrying it is part of the program, and a server
 * route file has no reason to import anything from Start at runtime. A
 * type-only import with no bindings puts it there and emits nothing.
 */
import type {} from "@tanstack/react-start";
