import { valClientHeaders } from "@valbuild/shared/internal";
import { VERSION } from "./version";

/**
 * `{ "x-val-client": "@valbuild/server@<version>" }`: spread into the headers
 * of every request this package sends to Val Build. See
 * `VAL_CLIENT_HEADER` in `@valbuild/shared` for why.
 */
export const VAL_CLIENT_HEADERS = valClientHeaders("@valbuild/server", VERSION);
