import { initVal, Internal } from "@valbuild/core";

// NOTE: initVal() must be called with an options object for `config` to be
// defined - the CLI requires val.config to export a config object.
const { s, c, config } = initVal({});

// `@valbuild/next` is what a real project takes its routers from; this fixture
// only depends on core, so it reads the same router off `Internal`.
const { nextAppRouter } = Internal;

export { s, c, config, nextAppRouter };
