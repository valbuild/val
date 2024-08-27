import { Api, ClientOf } from "./ApiRoutes";

export type ValClient = ClientOf<Api>;
export const createValClient = (host: string): ValClient => {
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
    // TODO: validate body
    return fetch(`${host}${fullPath}`, {
      method: method as string,
      headers: {
        "Content-Type": "application/json",
      },
      body: anyReq.body ? JSON.stringify(anyReq.body) : undefined,
    }).then(async (res) => {
      // TODO: validate and return errors
      const json = await res.json();
      return {
        status: res.status,
        json,
      };
    });
  };
};
