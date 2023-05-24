import { PrimaryButton } from "../Button";

export function FormContainer({ children }: { children: React.ReactNode }) {
  return (
    <form className="flex flex-col justify-between w-full px-4 py-2">
      {children}
      <div className="flex justify-end">
        <PrimaryButton>Save</PrimaryButton>
      </div>
    </form>
  );
}
