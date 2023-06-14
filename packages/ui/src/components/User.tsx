import { FC } from "react";

const User: FC<{name: string}> = ({name}) => {

    return(
        <div className="flex flex-row items-center gap-2">
            <div className="w-[32px] h-[32px] rounded-full bg-light-gray flex justify-center items-center">
                {name.split(' ').map((name) => name.charAt(0)).join("")}
            </div>
            <div className="text-white">
                {name}
            </div>
        </div>
    )
}

export default User;

