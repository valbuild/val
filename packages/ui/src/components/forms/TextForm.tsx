export type TextData = string;
export type TextInputProps = {
  name: string;
  text: TextData;
  onChange: (value: string) => void;
};

export function TextForm({ name, text, onChange }: TextInputProps) {
  return (
    <div
      className="w-full py-2 grow-wrap"
      data-replicated-value={text} /* see grow-wrap */
    >
      <textarea
        name={name}
        className="w-full p-2 border outline-none bg-fill text-primary border-border focus-visible:border-highlight"
        defaultValue={text}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
