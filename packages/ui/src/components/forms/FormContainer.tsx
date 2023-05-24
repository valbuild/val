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
        console.log(ev);
        const formData = new FormData(ev.currentTarget);
        console.log(formData);
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
