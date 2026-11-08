import { createRoot } from "react-dom/client";
import LandingPage from "./LandingPage";
import "./styles.css";

const repository = "https://github.com/LTY4869822/kaopu";
createRoot(document.getElementById("root")!).render(
  <LandingPage
    publicDemo
    onLogin={() => window.location.assign(repository + "#readme")}
    onRegister={() => window.location.assign("https://codespaces.new/LTY4869822/kaopu")}
  />
);
