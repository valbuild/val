import { ModuleFilePath } from "./val";

export type RouteValidationError = {
  error: {
    message: string;
    urlPath: string;
    expectedPath: string | null;
  };
};
export interface ValRouter {
  getRouterId(): string;
  validate(
    moduleFilePath: ModuleFilePath,
    urlPaths: string[],
  ): RouteValidationError[];
}
