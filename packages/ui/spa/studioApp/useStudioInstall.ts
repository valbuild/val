import { useSyncExternalStore } from "react";
import {
  getStudioInstall,
  StudioInstall,
  subscribeStudioInstall,
} from "./studioApp";

/**
 * How this Studio can be installed, if it can. Changes at most a couple of
 * times per page (the browser's offer arrives; the app is installed), so the
 * component that reads it renders that often and no more.
 */
export function useStudioInstall(): StudioInstall {
  return useSyncExternalStore(
    subscribeStudioInstall,
    getStudioInstall,
    getStudioInstall,
  );
}
