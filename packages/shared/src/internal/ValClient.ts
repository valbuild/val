import { Api, ApiEndpoint, ClientOf, ClientFetchErrors } from "./ApiRoutes";
import { fromZodError } from "zod-validation-error";

export type ValClient = ClientOf<Api>;
export const createValClient = (host: string): ValClient => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyApi = Api as any;
  return async (path, method, req) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any;
    let fullPath: string = path;
    if (anyReq?.path && anyReq.path.length > 0) {
      fullPath += anyReq.path;
    }
    if (anyReq.query) {
      const params: [string, string][] = [];
      for (const key of Object.keys(anyReq.query)) {
        if (Array.isArray(anyReq.query?.[key])) {
          for (const value of anyReq.query?.[key] || []) {
            params.push([key, value.toString()]);
          }
        } else {
          params.push([key, anyReq?.query?.[key]]);
        }
      }
      if (anyReq?.query && params.length > 0) {
        fullPath += `?${new URLSearchParams(params).toString()}`;
      }
    }
    const apiEndpoint: ApiEndpoint = anyApi?.[path]?.[method];
    if (!apiEndpoint) {
      return {
        status: null,
        json: {
          message: `Invalid route ${path} with method ${
            method as string
          }. This is most likely a Val bug.`,
          type: "client_side_validation_error",
          details: {
            validationError: `Route ${path} with method ${
              method as string
            } not found.`,
            data: {
              routes: Object.keys(anyApi || {}),
              methods: Object.keys(anyApi?.[path] || {}),
              route: path,
              method,
            },
          },
        },
      } satisfies ClientFetchErrors;
    }
    const reqBodyResult = apiEndpoint.req.body?.safeParse(anyReq.body);
    if (reqBodyResult && !reqBodyResult.success) {
      return {
        status: null,
        json: {
          message: "Invalid request body. This is most likely a Val bug.",
          type: "client_side_validation_error",
          details: {
            validationError: fromZodError(reqBodyResult.error).toString(),
            data: anyReq.body,
          },
        },
      } satisfies ClientFetchErrors;
    }
    try {
      const res = await fetch(`${host}${fullPath}`, {
        method: method as string,
        headers: {
          "Content-Type": "application/json",
        },
        body: anyReq.body ? JSON.stringify(anyReq.body) : undefined,
      }).then(async (res) => {
        const contentTypeHeaders = res.headers.get("content-type");
        if (!contentTypeHeaders?.includes("application/json")) {
          return {
            status: null,
            json: {
              type: "client_side_validation_error",
              message:
                "Invalid content type. This could be a result of mismatched Val versions.",
              details: {
                validationError: "Invalid content type",
                data: {
                  status: res.status,
                  contentType: contentTypeHeaders,
                },
              },
            },
          } satisfies ClientFetchErrors;
        }
        const json = await res.json();
        const valClientResult = {
          status: res.status,
          json,
        };
        const responseResult = apiEndpoint.res?.safeParse(valClientResult);
        if (responseResult && !responseResult.success) {
          return {
            status: null,
            json: {
              message:
                "Response could not be validated. This could be a result of mismatched Val versions.",
              type: "client_side_validation_error",
              details: {
                validationError: fromZodError(responseResult.error).toString(),
                data: valClientResult,
              },
            },
          } satisfies ClientFetchErrors;
        }
        return {
          status: res.status,
          json,
        };
      });
      return res;
    } catch (e) {
      return {
        status: null,
        json: {
          message: "Failed to fetch data. This is likely a network error.",
          type: "network_error",
          details: e instanceof Error ? e.message : JSON.stringify(e),
        },
      } satisfies ClientFetchErrors;
    }
  };
};
