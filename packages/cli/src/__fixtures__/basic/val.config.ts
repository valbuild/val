import { initVal } from "@valbuild/core";

// NOTE: initVal() must be called with an options object for `config` to be
// defined - the CLI requires val.config to export a config object.
const { s, c, config } = initVal({});

export { s, c, config };
