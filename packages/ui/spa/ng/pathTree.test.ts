import { pathTree } from "./pathTree";

describe("pathTree", () => {
  test("should successfully parse val module file paths", () => {
    const paths = [
      "/content/projects.val.ts",
      "/content/employees/employeeList.val.ts",
      "/content/pages/projects.val.ts",
      "/content/salary.val.ts",
      "/content/handbook.val.ts",
      "/content/handbook.val.ts",
    ];
    const res = pathTree(paths);
    expect(res).toEqual({
      name: "/",
      isDirectory: true,
      children: [
        {
          name: "content",
          isDirectory: true,
          children: [
            {
              name: "employees",
              isDirectory: true,
              children: [
                {
                  name: "employeeList.val.ts",
                  children: [],
                },
              ],
            },
            {
              name: "handbook.val.ts",
              children: [],
            },
            {
              name: "pages",
              isDirectory: true,
              children: [
                {
                  name: "projects.val.ts",
                  children: [],
                },
              ],
            },
            {
              name: "projects.val.ts",
              children: [],
            },
            {
              name: "salary.val.ts",
              children: [],
            },
          ],
        },
      ],
    });
  });
});
