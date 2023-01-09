import { NextPage } from "next";
import { useVal } from "../val.config";
import blog1Val from "./blog1.val";
import blog2Val from "./blog2.val";
import blog3Val from "./blog3.val";

const Home: NextPage = () => {
  const blog1 = useVal(blog1Val);
  const blog2 = useVal(blog2Val);
  const blog3 = useVal(blog3Val);
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
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 20px",
          }}
        >
          <h1>{blog1.title}</h1>
          <p>{blog1.text}</p>
        </section>
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 20px",
          }}
        >
          <h1>{blog2.title}</h1>
          <p>{blog2.text}</p>
        </section>
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 20px",
          }}
        >
          <h1>{blog3.title}</h1>
          <p>{blog3.text}</p>
        </section>
      </article>
    </main>
  );
};

export default Home;
