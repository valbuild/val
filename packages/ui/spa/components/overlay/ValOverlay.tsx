import { StringField } from "../../ng/fields/StringField";
import { useValConfig } from "../../ng/ValProvider";
import { Button } from "../ui/button";
2;
export type ValOverlayProps = {
  draftMode: boolean;
  setDraftMode: (draftMode: boolean) => void;
  disableOverlay: () => void;
  defaultTheme?: "dark" | "light";
  onSubmit: (refreshRequired: boolean) => void;
};

export function ValOverlay({ draftMode, setDraftMode }: ValOverlayProps) {
  const config = useValConfig();
  return (
    <div className="fixed p-4 bottom-1/2 right-2 bg-bg-primary text-text-primary">
      <StringField path={'/content/pages/home.val.ts?p="title"'} />
      <pre>{JSON.stringify(config, null, 2)}</pre>
      <Button
        onClick={() => {
          setDraftMode(!draftMode);
        }}
      >
        {draftMode ? "In draft" : "Not in draft"}
      </Button>
    </div>
  );
}
