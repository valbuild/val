import { RuleTester } from "eslint";
import { rules as valRules } from "@valbuild/eslint-plugin";
import path from "path";

const rule = valRules["no-illegal-imports"];

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

ruleTester.run("no-illegal-imports", rule, {
  valid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config';
import { eventSchema } from './event.val';

export const schema = s.array(eventSchema);
export default val.content('/foo/test', schema, [])`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config.ts';
import { eventSchema } from './event.val.ts';

export const schema = s.array(eventSchema);
export default val.content('/foo/test', schema, [])`,
    },
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config.ts';

export const schema = s.string();
export default val.content('/foo/test', schema, 'String')`,
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "./foo/test.val.ts"),
      code: `
import { val, s } from '../val.config';
import { eventSchema } from './event';

export const schema = s.array(eventSchema);
export default val.content('/foo/test', schema, [])`,
      errors: [
        {
          message:
            "Val: import source should be a .val.ts file, a @valbuild package, or val.config.ts. Found: './event'",
        },
      ],
    },
  ],
});
