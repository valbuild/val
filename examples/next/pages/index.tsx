import { NextPage } from "next";
import { useVal } from "../val.config";
import blogVal from "./blog.val";

const Home: NextPage = () => {
  const blog = useVal(blogVal);
  return (
    <div>
      <h1>{blog.title}</h1>
      <p>{blog.text}</p>
    </div>
  );
};

export default Home;
