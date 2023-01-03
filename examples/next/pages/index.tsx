import { NextPage } from "next";
import { useVal } from "../val.config";
import blogVal from "./blog.val";

const Home: NextPage = () => {
  const blog = useVal(blogVal);
  return <div>{blog.title}</div>;
};

export default Home;
