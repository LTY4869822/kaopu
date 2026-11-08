import { Component, type ReactNode } from "react";

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-recovery" role="alert">
      <div><h1>页面暂时未打开</h1><p>可能遇到了版本更新或连接中断。重新打开后继续，已保存的资料和作答仍会保留。</p>
        <div className="app-recovery-actions"><button type="button" onClick={() => window.location.reload()}>重新打开页面</button><a href="?page=materials">返回我的课程</a></div>
      </div>
    </main>;
  }
}
