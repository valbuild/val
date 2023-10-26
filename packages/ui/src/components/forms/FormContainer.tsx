import { PrimaryButton } from "../Button";

export function FormContainer({
  children,
  onSubmit,
}: {
  children: React.ReactNode;
  onSubmit: () => void;
}) {
  return (
    <form
      className="val-flex val-flex-col val-justify-between val-w-full val-px-4 val-py-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div className="val-flex val-justify-end">
        <PrimaryButton>Save</PrimaryButton>
      </div>
    </form>
  );
}
