import { NextPage } from "next";
import { useVal } from "@valbuild/next";
import blogsVal from "../blogs.val";

const Home: NextPage = () => {
  const blogs = useVal(blogsVal);
  return (
    <main
      style={{
        background: "#fffcb6",
        color: "#272D2A",
        fontSize: 20,
        minHeight: "100vh",
      }}
    >
      <article
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          maxWidth: "800px",
          margin: "0 auto",
        }}
      >
        {blogs.map((blog) => (
          <section
            key={blog.title}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 20px",
            }}
          >
            <h1>{blog.title}</h1>
            <p>{blog.text}</p>
          </section>
        ))}
      </article>
    </main>
  );
};

export default Home;
