export type TextInputProps = {
  name: string;
  source: string;
  onChange: (value: string) => void;
};

export function TextInput({ name, source, onChange }: TextInputProps) {
  return (
    <div
      className="w-full py-2 grow-wrap"
      data-replicated-value={source} /* see grow-wrap */
    >
      <textarea
        name={name}
        className="w-full p-2 border outline-none bg-fill text-primary border-border"
        value={source}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
