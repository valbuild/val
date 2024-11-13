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
      fullPath: "/",
      isDirectory: true,
      children: [
        {
          name: "content",
          fullPath: "/content",
          isDirectory: true,
          children: [
            {
              name: "projects.val.ts",
              fullPath: "/content/projects.val.ts",
              children: [],
            },
            {
              name: "employees",
              fullPath: "/content/employees",
              isDirectory: true,
              children: [
                {
                  name: "employeeList.val.ts",
                  fullPath: "/content/employees/employeeList.val.ts",
                  children: [],
                },
              ],
            },
            {
              name: "pages",
              fullPath: "/content/pages",
              isDirectory: true,
              children: [
                {
                  name: "projects.val.ts",
                  fullPath: "/content/pages/projects.val.ts",
                  children: [],
                },
              ],
            },
            {
              name: "salary.val.ts",
              fullPath: "/content/salary.val.ts",
              children: [],
            },
            {
              name: "handbook.val.ts",
              fullPath: "/content/handbook.val.ts",
              children: [],
            },
          ],
        },
      ],
    });
  });
});
