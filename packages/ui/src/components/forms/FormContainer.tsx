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
      className="flex flex-col justify-between w-full px-4 py-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit();
      }}
    >
      {children}
      <div className="flex justify-end">
        <PrimaryButton>Save</PrimaryButton>
      </div>
    </form>
  );
}
