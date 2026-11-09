import { useState } from "react";
import { createRoot } from "react-dom/client";
import LandingPage from "./LandingPage";
import LandingWorkbench from "./LandingWorkbench";
import "./styles.css";
import "./pages.css";

const repository = "https://github.com/LTY4869822/kaopu";
const steps = ["资料归科", "整理笔记", "巩固练习"] as const;

function DemoWorkspace() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  return (
    <main className="sf-landing public-workspace" data-theme="light">
      <div className="public-workspace-inner">
        <a href="./">← 返回考谱首页</a>
        <h1>考谱示例工作台</h1>
        <p>用三份示例课件试一遍，从资料归科到做题。</p>
        <div className="public-workspace-steps" role="group" aria-label="选择复习步骤">
          {([0, 1, 2] as const).map(index => (
            <button key={index} type="button" aria-pressed={step === index} onClick={() => setStep(index)}>
              {steps[index]}
            </button>
          ))}
        </div>
        <LandingWorkbench step={step} />
      </div>
    </main>
  );
}

const showDemo = new URLSearchParams(window.location.search).get("demo") === "1";
createRoot(document.getElementById("root")!).render(
  showDemo ? <DemoWorkspace /> :
  <LandingPage
    publicDemo
    onLogin={() => window.location.assign(repository + "#readme")}
    onRegister={() => window.location.assign("?demo=1")}
  />
);
