import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModuleFilePath } from "@valbuild/core";

/**
 * "Open the upload dialog for this gallery."
 *
 * The navigation can ask for an upload, but it cannot perform one. Uploading
 * into a gallery means computing the file's ref from its hash and the gallery's
 * directory, deciding local or remote, building the metadata entry and the file
 * op together, and driving the two-phase upload — all of which `ModuleGallery`
 * already does, and none of which should exist twice. That is the whole reason
 * this is a request rather than a callback: the Media panel names the gallery,
 * and the gallery does the work.
 *
 * A nonce rather than a boolean, so asking for the same gallery twice in a row
 * is two requests. Without it the second click after a cancelled dialog would
 * be a no-op, which reads as a broken button.
 */
type UploadRequest = {
  moduleFilePath: ModuleFilePath;
  nonce: number;
};

type UploadRequestValue = {
  request: UploadRequest | null;
  requestUpload: (moduleFilePath: ModuleFilePath) => void;
  clearRequest: () => void;
};

const UploadRequestContext = createContext<UploadRequestValue>({
  request: null,
  requestUpload: () => undefined,
  clearRequest: () => undefined,
});

export function UploadRequestProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<UploadRequest | null>(null);
  const nonce = useRef(0);
  const requestUpload = useCallback((moduleFilePath: ModuleFilePath) => {
    nonce.current += 1;
    setRequest({ moduleFilePath, nonce: nonce.current });
  }, []);
  const clearRequest = useCallback(() => setRequest(null), []);
  const value = useMemo<UploadRequestValue>(
    () => ({ request, requestUpload, clearRequest }),
    [request, requestUpload, clearRequest],
  );
  return (
    <UploadRequestContext.Provider value={value}>
      {children}
    </UploadRequestContext.Provider>
  );
}

/** Ask for an upload into a gallery. Used by the navigation. */
export function useRequestUpload(): (moduleFilePath: ModuleFilePath) => void {
  return useContext(UploadRequestContext).requestUpload;
}

/**
 * Answer a request aimed at this module, once.
 *
 * The dialog is opened from an effect rather than from the click itself, because
 * the gallery has to mount first. Browsers allow that: opening a file dialog
 * needs transient user activation, and the click that named the gallery leaves
 * several seconds of it — long enough for a same-document navigation and a
 * mount. If a browser ever declines, the fallback is not a dead end: the request
 * still put you in the gallery, which has an upload button of its own.
 */
export function useUploadRequest(
  moduleFilePath: ModuleFilePath,
  openDialog: () => void,
): void {
  const { request, clearRequest } = useContext(UploadRequestContext);
  const openRef = useRef(openDialog);
  openRef.current = openDialog;
  useEffect(() => {
    if (request === null || request.moduleFilePath !== moduleFilePath) {
      return;
    }
    clearRequest();
    openRef.current();
  }, [request, moduleFilePath, clearRequest]);
}
