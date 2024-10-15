/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useValState } from "./useValState"; // Import the hook
import {
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  Schema,
  SelectorSource,
  SerializedSchema,
  ValModule,
} from "@valbuild/core";
import { Api, ValClient } from "@valbuild/shared/internal";
import { z } from "zod";

describe("useValState hook", () => {
  let clientMock: jest.Mock;

  beforeEach(() => {
    const { s, c } = initVal();
    const testData = createTestData([
      c.define("/content/test.val.ts", s.object({ key: s.string() }), {
        key: "value",
      }),
    ]);
    clientMock = jest.fn((async (route, method, params) => {
      if (route === "/schema" && method === "GET") {
        const schemas: Partial<Record<ModuleFilePath, SerializedSchema>> = {};
        for (const [moduleFilePath, { schema }] of Object.entries(testData)) {
          if (schema) {
            schemas[moduleFilePath as ModuleFilePath] = schema.serialize();
          }
        }
        const res: z.infer<Api["/schema"]["GET"]["res"]> = {
          status: 200,
          json: {
            schemaSha: "123",
            schemas,
          },
        };
        return res;
      }
      return {
        status: 404,
        json: {
          message: "Not Found",
        },
      };
    }) satisfies ValClient);
    jest.clearAllMocks();
  });

  const setupHook = (statInterval?: number) => {
    return renderHook(() => useValState(clientMock, statInterval));
  };

  it("should initialize with default values", async () => {
    let result: ReturnType<typeof setupHook>["result"] = await act(async () => {
      result = setupHook().result;
      return result;
    });

    expect(result.current.stat.status).toBe("not-asked");
    expect(result.current.schemas.status).toBe("not-asked");
    expect(result.current.sources).toEqual({});
    expect(result.current.patchData).toEqual({});
    expect(result.current.errors).toEqual({});
  });
});

function createTestData(data: ValModule<SelectorSource>[]) {
  const res: Record<
    ModuleFilePath,
    { schema?: Schema<SelectorSource>; source: Json }
  > = {};

  for (const d of data) {
    const moduleFilePath = Internal.getValPath(d) as unknown as ModuleFilePath;
    if (!moduleFilePath) {
      throw new Error(
        `Module file path ${moduleFilePath} not found in test data`,
      );
    }
    res[moduleFilePath] = {
      schema: Internal.getSchema(d),
      source: Internal.getSource(d),
    };
  }

  return res;
}
