import { RuleTester } from "eslint";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["default-export-val-module"];

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

ruleTester.run("default-export-val-module", rule, {
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
      const a = c.define('/foo/test.val.ts', schema, 'String')`,
      errors: [
        {
          message: "Val: c.define must be exported as default",
        },
      ],
      output: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('/foo/test.val.ts', schema, 'String')`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      {
        c.define('/foo/test.val.ts', schema, 'String')
      }`,
      errors: [
        {
          message: "Val: c.define must be exported as default",
        },
      ],
      output: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      {
        c.define('/foo/test.val.ts', schema, 'String')
      }`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      c.define('/foo/test.val.ts', schema, 'String')`,
      errors: [
        {
          message: "Val: c.define must be exported as default",
        },
      ],
      output: `import { c, s } from '../val.config.ts';
      export const schema = s.string();
      export default c.define('/foo/test.val.ts', schema, 'String')`,
    },
  ],
});
