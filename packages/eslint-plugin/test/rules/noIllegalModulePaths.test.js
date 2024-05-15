import { RuleTester } from "eslint";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["no-illegal-module-paths"];

RuleTester.setDefaultConfig({
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
});

const ruleTester = new RuleTester();

ruleTester.run("no-illegal-module-paths", rule, {
  valid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('/foo/test.val.ts', schema, 'String')`,
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('foo.val.ts', schema, 'String')`,
      errors: [
        {
          message:
            "Val: c.define path must match the filename. Expected: '/foo/test.val.ts'. Found: 'foo.val.ts'",
        },
      ],
      output: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('/foo/test.val.ts', schema, 'String')`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define("foo.val.ts", schema, 'String')`,
      errors: [
        {
          message:
            "Val: c.define path must match the filename. Expected: '/foo/test.val.ts'. Found: 'foo.val.ts'",
        },
      ],
      output: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define("/foo/test.val.ts", schema, 'String')`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define(\`foo.val.ts\`, schema, 'String')`,
      errors: [
        {
          message: "Val: c.define path should not be a template literal",
        },
      ],
      output: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define("/foo/test.val.ts", schema, 'String')`,
    },
  ],
});
