import { RuleTester } from "eslint";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["no-illegal-module-ids"];

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

ruleTester.run("no-illegal-module-ids", rule, {
  valid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('/foo/test', schema, 'String')`,
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('foo', schema, 'String')`,
      errors: [
        {
          message:
            "Val: c.define id should match the filename. Expected: '/foo/test'. Found: 'foo'",
        },
      ],
      output: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('/foo/test', schema, 'String')`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define("foo", schema, 'String')`,
      errors: [
        {
          message:
            "Val: c.define id should match the filename. Expected: '/foo/test'. Found: 'foo'",
        },
      ],
      output: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define("/foo/test", schema, 'String')`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define(\`foo\`, schema, 'String')`,
      errors: [
        {
          message: "Val: c.define id should not be a template literal",
        },
      ],
      output: `import { c, s } from "../val.config.ts";
      export const schema = s.string();
      export default c.define("/foo/test", schema, 'String')`,
    },
  ],
});
