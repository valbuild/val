import { FC, ReactNode } from "react";
import ExpandLogo from "./ExpandLogo";

export const DashboardButton: FC<{
  onClick: () => void;
  expanded: boolean;
  children: ReactNode;
}> = ({ onClick, children, expanded }) => {
  return (
    <button
      onClick={onClick}
      className="py-2 px-3 font-serif text-[12px] tracking-[0.04em] font-[500] border rounded-md text-white dark:border-white border-warm-black bg-warm-black group dark:hover:border-highlight hover:text-highlight "
    >
      <span className="flex flex-row items-center justify-center gap-2">
        {<ExpandLogo expanded={expanded} className='fill-white group-hover:fill-highlight' />}
        {children}
      </span>
    </button>
  );
};
