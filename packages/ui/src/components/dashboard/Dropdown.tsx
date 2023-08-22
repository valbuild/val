import classNames from "classnames";
import {
  ReactElement,
  ReactNode,
  useRef,
  useState
} from "react";

type DropdownProps = {
  options?: string[];
  onClick?: (path: string) => void;
};
export function Dropdown({
  options = [],
  onClick,
}: DropdownProps): ReactElement {
  const [selected, setSelected] = useState<string>(options[0]);
  const dropdownRef = useRef<HTMLSelectElement>(null);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelected(event.target.value);
    if (onClick) onClick(event.target.value);
  };

  return (
    <select
      className="relative w-full justify-start font-serif text-xs group bg-warm-black text-white hover:bg-dark-gray px-4 mx-2"
      onChange={handleChange}
      ref={dropdownRef}
    >
      {options.map((option, index) => (
        <option
          key={index}
          value={option}
          className={classNames(
            { "bg-yellow": selected === option },
            { "bg-red": selected !== option }
          )}
        >
          {option}
        </option>
      ))}
    </select>
  );
}

type DropdownChildProps = {
  children?: ReactNode | ReactNode[];
  id?: string | number;
  onClick?: () => void;
  selected?: boolean;
};

Dropdown.Child = ({
  children,
  onClick,
  selected,
}: DropdownChildProps): ReactElement => {
  return (
    <div
      onClick={() => {
        if (onClick) {
          onClick();
        }
      }}
      className={classNames(
        "flex flex-col py-2 px-3 w-full justify-start items-start  bg-warm-black group-hover:bg-dark-gray hover:bg-dark-gray tracking-wider text-[12px] font-[400] font-serif hover:cursor-pointer",
        { "bg-yellow text-warm-black ": selected },
        { "text-white ": !selected }
      )}
    >
      {children}
    </div>
  );
};
