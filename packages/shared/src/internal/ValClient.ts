import { Api, ApiEndpoint, ClientOf, ClientFetchErrors } from "./ApiRoutes";
import { fromZodError } from "zod-validation-error";
import { SharedValConfig } from "./SharedValConfig";

export type ValClient = ClientOf<Api>;
export const createValClient = (
  host: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config: SharedValConfig | null, // We want to use this in the future
): ValClient => {
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
            if (value !== undefined) {
              params.push([key, value.toString()]);
            }
          }
        } else {
          if (anyReq.query?.[key] !== undefined) {
            params.push([key, anyReq?.query?.[key].toString()]);
          }
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
      console.error(
        "Got an invalid request body while validating client-side. This is most likely a Val bug.",
        {
          body: anyReq.body,
          error: reqBodyResult.error,
        },
      );
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
        body:
          anyReq.body !== undefined ? JSON.stringify(anyReq.body) : undefined,
      }).then(async (res) => {
        const contentTypeHeaders = res.headers.get("content-type");
        if (res.status === 413) {
          return {
            status: 413,
            json: {
              message: `Request too large.`,
              method: method as string,
              path: path,
            },
          } satisfies ClientFetchErrors;
        }
        if (!contentTypeHeaders?.includes("application/json")) {
          return {
            status: null,
            json: {
              type: "client_side_validation_error",
              message: `Invalid response (expected JSON, but got something else). This could be a result of mismatched Val versions or a transient error. ${res.status}`,
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
        if (res.status === 500) {
          console.error("Server responded with an error", json);
          return {
            status: 500,
            json: {
              type: "unknown",
              message: json.message,
              ...json,
            },
          } satisfies ClientFetchErrors;
        }
        const responseResult = apiEndpoint.res?.safeParse(valClientResult);
        if (responseResult && !responseResult.success) {
          return {
            status: null,
            json: {
              message:
                "Response could not be validated. This could also be a result of mismatched Val versions.",
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
          message: "Failed to fetch data",
          type: "network_error",
          retryable: isRetryable(e),
          details: e instanceof Error ? e.message : JSON.stringify(e),
        },
      } satisfies ClientFetchErrors;
    }
  };
};

function isRetryable(error: unknown) {
  if (error instanceof TypeError) {
    // TypeError is usually thrown by fetch when the network request fails.
    return true;
  }
  if (error instanceof Error && "code" in error) {
    const errorCode = (error as { code: string }).code;

    // Network-specific errors (Node.js specific)
    const retryableErrorCodes = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
    ];
    return retryableErrorCodes.includes(errorCode);
  }
  return false;
}
