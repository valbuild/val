import { lexer } from "./lexer";

const cases: {
  description: string;
  input: string;
  expected?: ReturnType<typeof lexer>;
}[] = [
  {
    description: "basic",
    input: `
# Title 1

## Title 2

### Title 3

#### Title 4

##### Title 5

###### Title 6

Some paragraph. Another sentence.

Another paragraph.

Formatting: **bold**, _italic_, ~~line-through~~, ***bold and italic***.

- List 1
    1. List 1.1
    1. List 1.2
`,
  },
  {
    description: "basics",
    input: `test hallo`,
    expected: {
      tokens: [
        { type: "text", raw: "test" },
        { type: "space", amount: 1 },
        { type: "text", raw: "hallo" },
      ],
      errors: [],
    },
  },
  {
    description: "merge digits",
    input: `Merge digits like 1 as well`,
    expected: {
      tokens: [
        { type: "text", raw: "Merge" },
        { type: "space", amount: 1 },
        { type: "text", raw: "digits" },
        { type: "space", amount: 1 },
        { type: "text", raw: "like" },
        { type: "space", amount: 1 },
        { type: "text", raw: "1" },
        { type: "space", amount: 1 },
        { type: "text", raw: "as" },
        { type: "space", amount: 1 },
        { type: "text", raw: "well" },
      ],
      errors: [],
    },
  },
  {
    description: "heading 1",
    input: `# Heading 1`,
    expected: {
      tokens: [
        { type: "#", amount: 1 },
        { type: "space", amount: 1 },
        { type: "text", raw: "Heading" },
        { type: "space", amount: 1 },
        { type: "text", raw: "1" },
      ],
      errors: [],
    },
  },
  {
    description: "heading 6",
    input: `###### Heading 6`,
    expected: {
      tokens: [
        { type: "#", amount: 6 },
        { type: "space", amount: 1 },
        { type: "text", raw: "Heading" },
        { type: "space", amount: 1 },
        { type: "text", raw: "6" },
      ],
      errors: [],
    },
  },
  {
    description: "heading 6 on both sides",
    input: `###### Heading 6 ######`,
    expected: {
      tokens: [
        { type: "#", amount: 6 },
        { type: "space", amount: 1 },
        { type: "text", raw: "Heading" },
        { type: "space", amount: 1 },
        { type: "text", raw: "6" },
        { type: "space", amount: 1 },
        { type: "#", amount: 6 },
      ],
      errors: [],
    },
  },
  {
    description: "unordered lists",
    input: `My list:
- Item 1
- Item 2
    `,
    expected: {
      tokens: [
        { type: "text", raw: "My" },
        { type: "space", amount: 1 },
        { type: "text", raw: "list:" },
        { type: "\n", amount: 1 },
        { type: "-", amount: 1 },
        { type: "space", amount: 1 },
        { type: "text", raw: "Item" },
        { type: "space", amount: 1 },
        { type: "text", raw: "1" },
        { type: "\n", amount: 1 },
        { type: "-", amount: 1 },
        { type: "space", amount: 1 },
        { type: "text", raw: "Item" },
        { type: "space", amount: 1 },
        { type: "text", raw: "2" },
        { type: "\n", amount: 1 },
        { type: "space", amount: 4 },
      ],
      errors: [],
    },
  },
  {
    description: "ordered lists",
    input: `My list:
1. Item 1
1. Item 2
    `,
    expected: {
      tokens: [
        { type: "text", raw: "My" },
        { type: "space", amount: 1 },
        { type: "text", raw: "list:" },
        { type: "\n", amount: 1 },
        { type: "(1-9).", raw: "1." },
        { type: "space", amount: 1 },
        { type: "text", raw: "Item" },
        { type: "space", amount: 1 },
        { type: "text", raw: "1" },
        { type: "\n", amount: 1 },
        { type: "(1-9).", raw: "1." },
        { type: "space", amount: 1 },
        { type: "text", raw: "Item" },
        { type: "space", amount: 1 },
        { type: "text", raw: "2" },
        { type: "\n", amount: 1 },
        { type: "space", amount: 4 },
      ],
      errors: [],
    },
  },
  {
    description: "basics: heading, newlines, ...",
    input: `# Heading 1
    
    Some text
    `,
    expected: {
      tokens: [
        { type: "#", amount: 1 },
        { type: "space", amount: 1 },
        { type: "text", raw: "Heading" },
        { type: "space", amount: 1 },
        { type: "text", raw: "1" },
        { type: "\n", amount: 1 },
        { type: "space", amount: 4 },
        { type: "\n", amount: 1 },
        { type: "space", amount: 4 },
        { type: "text", raw: "Some" },
        { type: "space", amount: 1 },
        { type: "text", raw: "text" },
        { type: "\n", amount: 1 },
        { type: "space", amount: 4 },
      ],
      errors: [],
    },
  },
  {
    description: "latin-1",
    input: `å, ø, æ, Å, Ø, Æ`,
    expected: {
      tokens: [
        { type: "text", raw: "å," },
        { type: "space", amount: 1 },
        { type: "text", raw: "ø," },
        { type: "space", amount: 1 },
        { type: "text", raw: "æ," },
        { type: "space", amount: 1 },
        { type: "text", raw: "Å," },
        { type: "space", amount: 1 },
        { type: "text", raw: "Ø," },
        { type: "space", amount: 1 },
        { type: "text", raw: "Æ" },
      ],
      errors: [],
    },
  },
  {
    description: "emoji",
    input: `🤔, 🤔🤔, 🤔🤔🤔`,
    expected: {
      tokens: [
        { type: "text", raw: "🤔," },
        { type: "space", amount: 1 },
        { type: "text", raw: "🤔🤔," },
        { type: "space", amount: 1 },
        { type: "text", raw: "🤔🤔🤔" },
      ],
      errors: [],
    },
  },
  {
    description: "basic br",
    input: `Hello<br />World<br/>Here we go`,
    expected: {
      tokens: [
        { type: "text", raw: "Hello" },
        { type: "<br/>", raw: "<br />" },
        { type: "text", raw: "World" },
        { type: "<br/>", raw: "<br/>" },
        { type: "text", raw: "Here" },
        { type: "space", amount: 1 },
        { type: "text", raw: "we" },
        { type: "space", amount: 1 },
        { type: "text", raw: "go" },
      ],
      errors: [],
    },
  },
  {
    description: "br with spaces",
    input: `hello <   br   /> world`,
    expected: {
      tokens: [
        { type: "text", raw: "hello" },
        { type: "space", amount: 1 },
        { type: "<br/>", raw: "<   br   />" },
        { type: "space", amount: 1 },
        { type: "text", raw: "world" },
      ],
      errors: [],
    },
  },
  {
    description: "formatting",
    input: `**bold**, _italic_, ~~line-through~~, ***bold and italic***`,
    expected: {
      tokens: [
        { type: "*", amount: 2 },
        { type: "text", raw: "bold" },
        { type: "*", amount: 2 },
        { type: "text", raw: "," },
        { type: "space", amount: 1 },
        { type: "_", amount: 1 },
        { type: "text", raw: "italic" },
        { type: "_", amount: 1 },
        { type: "text", raw: "," },
        { type: "space", amount: 1 },
        { type: "~", amount: 2 },
        { type: "text", raw: "line" },
        { type: "-", amount: 1 },
        { type: "text", raw: "through" },
        { type: "~", amount: 2 },
        { type: "text", raw: "," },
        { type: "space", amount: 1 },
        { type: "*", amount: 3 },
        { type: "text", raw: "bold" },
        { type: "space", amount: 1 },
        { type: "text", raw: "and" },
        { type: "space", amount: 1 },
        { type: "text", raw: "italic" },
        { type: "*", amount: 3 },
      ],
      errors: [],
    },
  },
  {
    description: "all features",
    input: `
# Title 1

Title 1 content.

## Title 2

Title 2 content.

### Title 3

Title 3 content.

#### Title 4

Title 4 content.

##### Title 5

###### Title 6

Some paragraph. Another sentence.

Another paragraph.

Formatting: **bold**, _italic_, ~~line-through~~, ***bold and italic***.

- List 1
    1. List 1.1
    1. List 1.2

More Text

<br />

  Even more

<br />

- List 1
    1. List 1.1
    1. List 1.2
- List 2
- List 3
    1. Formatted **list**<br />
Test 123
`,
  },
];

describe("lexer", () => {
  test.each(cases)("$description", ({ description, input, expected }) => {
    if (expected) {
      expect(lexer(input)).toStrictEqual(expected);
    } else {
      console.warn("WIP:", description);
      console.log(lexer(input));
    }
  });
});
