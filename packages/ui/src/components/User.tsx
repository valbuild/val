import { FC } from "react";

const User: FC<{ name: string }> = ({ name }) => {
  return (
    <div className="val-flex val-flex-row val-items-center val-gap-2">
      <div className="val-w-[32px] val-h-[32px] val-rounded-full val-bg-light-gray val-flex val-justify-center val-items-center">
        {name
          .split(" ")
          .map((name) => name.charAt(0))
          .join("")}
      </div>
      <div className="val-text-white">{name}</div>
    </div>
  );
};

export default User;
