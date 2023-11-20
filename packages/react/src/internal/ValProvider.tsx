import type {
  UseValApi,
  UseValStore,
  ValProviderProps,
} from "./ValProviderInternal";
import ValProviderInternal from "./ValProviderInternal";

const useValProviderModule = ():
  | undefined
  | { useValStore: UseValStore; useValApi: UseValApi } => {
  // TODO: remove this madness
  if (ValProviderInternal) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AnyValProviderModule = ValProviderInternal as any;
    if (AnyValProviderModule.status === "fulfilled") {
      return AnyValProviderModule.value;
    } else if (AnyValProviderModule.status === "rejected") {
      throw AnyValProviderModule.value;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw AnyValProviderModule.then((res: any) => {
        AnyValProviderModule.status = "fulfilled";
        AnyValProviderModule.value = res;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).catch((err: any) => {
        AnyValProviderModule.status = "rejected";
        AnyValProviderModule.value = err;
      });
    }
  }
  return;
};

export const useValApi = () => {
  const valProviderModule = useValProviderModule();
  if (valProviderModule) {
    return valProviderModule.useValApi();
  }
  return undefined;
};

export const useValStore = () => {
  const valProviderModule = useValProviderModule();
  if (valProviderModule) {
    return valProviderModule.useValStore();
  }
};

export function ValProvider({ children }: ValProviderProps): JSX.Element {
  return <ValProviderInternal>{children}</ValProviderInternal>;
}
