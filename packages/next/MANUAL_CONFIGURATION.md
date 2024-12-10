# Configuring Val manually

You can setup Val in your Next.js project manually by following the steps below:

- Make sure your project is using TypeScript 5+, Next 14+, React 18.20.+
- Install the Val packages using your favorite package manager. For npm, you can run:

  ```bash
  npm install @valbuild/core @valbuild/next
  ```

- Create the `/val.config.ts` file in the root of the project (where your `package.json` file is located):

  ```ts
  import { initVal } from "@valbuild/next";

  const { s, c, val, config } = initVal({
    defaultTheme: "dark",
  });

  export type { t } from "@valbuild/next";
  export { s, c, val, config };
  ```

  **NOTE**: after you have created the config file, you can set it up to work in production for editors by following the steps described in the [remote mode section](./README.md#remote-mode)

- Create the `/val/val.server.ts` file:

  ```ts
  import "server-only";
  import { initValServer } from "@valbuild/next/server";
  import { config } from "../val.config";
  import { draftMode } from "next/headers";
  import valModules from "../val.modules";

  const { valNextAppRouter } = initValServer(
    valModules,
    { ...config },
    {
      draftMode,
    },
  );

  export { valNextAppRouter };
  ```

  If you use prettier (or something else) to format your files, continue by following the steps [here](./README.md#formatting-published-content).

- Create the `/val.modules.ts` file:

  ```ts
  import { modules } from "@valbuild/next";
  import { config } from "./val.config";

  export default modules(config, [
    // Add your modules here
  ]);
  ```

- If you need Val in React Client Components, setup the `useVal` hook by creating the following `/val/val.client.ts` file:

  ```ts
  import "client-only";
  import { initValClient } from "@valbuild/next/client";
  import { config } from "../val.config";

  const { useValStega: useVal } = initValClient(config);

  export { useVal };
  ```

- If you need Val in React Server Components, setup `fetchVal` by creating the following `/val/val.rsc.ts` file:

  ```ts
  import "client-only";
  import { initValClient } from "@valbuild/next/client";
  import { config } from "../val.config";

  const { useValStega: useVal } = initValClient(config);

  export { useVal };
  ```

- If you want to use the recommended Val prettier rules, install the Val eslint package:

  ```bash
  npm i -D @valbuild/eslint-plugin
  ```

  Then add the rule in the `extends` section in your `/eslintrc.js` file:

  ```json
   "plugin:@valbuild/recommended",
  ```
