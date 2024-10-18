import { Api, UrlOf } from "./ApiRoutes";

export type ValUrls = UrlOf<typeof Api>;
export const urlOf: ValUrls = (...args) => {
  const route = args[0];
  const query = args[1];
  if (query) {
    const params: [string, string][] = Object.entries(query).flatMap(
      ([key, value]) => {
        if (!value) {
          return [];
        }
        return [[key, value.toString()]];
      },
    );
    const searchParams = new URLSearchParams(params);
    return `${route + "?" + searchParams.toString()}`;
  }
  return `${route}`;
};
