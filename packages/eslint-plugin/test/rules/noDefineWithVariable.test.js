import { RuleTester } from "eslint";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["no-define-with-variable"];

const ruleTester = new RuleTester();

ruleTester.run("no-define-with-variable", rule, {
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
      const str = 'String'
      export default c.define('/foo/test.val.ts', schema, str)`,
      errors: [
        {
          message: "Val: third argument of c.define cannot be a variable",
        },
      ],
    },
  ],
});
