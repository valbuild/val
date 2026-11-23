import { test } from "@playwright/test";
import { NEXT_APP_URL } from "./apps";
import { defineInlineEditingSuite } from "./inlineEditingSuite";

// `@valbuild/next`'s canvas bridge is its own copy of the page's half: see
// the suite.
test.use({ baseURL: NEXT_APP_URL });

defineInlineEditingSuite();
