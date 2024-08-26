import { Api, ClientOf } from "./ApiRoutes";

export type ValClient = ClientOf<Api>;
export const createValClient = (host: string): ValClient => {
  return async (path, method, req) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyReq = req as any;
    const params: [string, string][] = [];
    if (anyReq.query) {
      for (const key of Object.keys(anyReq.query)) {
        if (Array.isArray(anyReq.query?.[key])) {
          for (const value of anyReq.query?.[key] || []) {
            params.push([key, value.toString()]);
          }
        } else {
          params.push([key, anyReq?.query?.[key]]);
        }
      }
    }
    let fullPath: string = path;
    if (anyReq?.params && params.length > 0) {
      fullPath = `${path}?${new URLSearchParams(params).toString()}`;
    }
    if (anyReq?.path && anyReq.path.length > 0) {
      fullPath = `${path}${anyReq.path}`;
    }

    // TODO: validate body
    return fetch(`${host}${fullPath}`, {
      method: method as string,
      headers: {
        "Content-Type": "application/json",
      },
      body: anyReq.body ? JSON.stringify(anyReq.body) : undefined,
    }).then((res) => {
      // TODO: validate and return errors
      return {
        status: res.status,
        json: res.json(),
      };
    });
  };
};
