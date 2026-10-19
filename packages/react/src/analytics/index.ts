// Loaded only by a page with analytics on, and only for a visitor. Imports
// nothing from @valbuild/core, @valbuild/shared or zod -- see `beacon.ts`.
export {
  startValAnalytics,
  type ValAnalytics,
  type ValAnalyticsOptions,
} from "./tracker";
export {
  buildBeacons,
  type AnalyticsBeacon,
  type AnalyticsDevice,
  type AnalyticsPageView,
  type AnalyticsPaths,
  type AnalyticsUtm,
  MAX_PATHS_PER_BEACON,
  MAX_ROUTE_LENGTH,
  MAX_UTM_LENGTH,
} from "./beacon";
export { splitValPaths } from "./splitValPaths";
