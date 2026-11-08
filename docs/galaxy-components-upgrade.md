# Galaxy 组件适配

使用的仓库：[uiverse-io/galaxy](https://github.com/uiverse-io/galaxy)，固定参考提交 adbd2adde0a299a3956ea288fb444ec01891ca41。实际下载源码到 .local/references/galaxy 后筛选；没有引入整套库，也没有执行仓库 HTML 或脚本。

原始代码为 HTML/CSS 片段，不能当作完整 React / 无障碍组件库直接接入。本次按以下原件的具体做法适配到考谱，保留原生 button、checkbox、radio 和已有 React 事件。

| 来源 | 采用与调整 |
| --- | --- |
| [cssbuttons-io / massive-mayfly-74](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Buttons/cssbuttons-io_massive-mayfly-74.html) | 持续可见的按钮文字和轻微移动的箭头。没有照搬圆形扩张、英文大写或大幅位移。用于分析资料、开始练习、提交整组、测试并保存等主操作。 |
| [Admin12121 / cold-bobcat-20](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Radio-buttons/Admin12121_cold-bobcat-20.html) | 根据当前选择滑动的背景块。改为暖灰轨道、白色选中块、现有 aria-pressed 按钮；移除差值混合与红色描边。用于模型与练习方式切换，规划延续同一细节。 |
| [IndexOC / moody-mouse-53](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Checkboxes/IndexOC_moody-mouse-53.html) | 方形复选框与清楚的对勾。保留真实输入框，改用 CSS appearance 与 SVG 对勾，不隐藏原生控件，不使用内凹阴影。 |
| [PriyanshuGupta28 / silent-rabbit-98](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/Checkboxes/PriyanshuGupta28_silent-rabbit-98.html) | 紧凑边框和明确的选中底色。统一全站普通复选框的选中、未选中、禁用和混合状态，保留标签与键盘行为。 |
| [AbanoubMagdy1 / hungry-elephant-87](https://github.com/uiverse-io/galaxy/blob/adbd2adde0a299a3956ea288fb444ec01891ca41/loaders/AbanoubMagdy1_hungry-elephant-87.html) | 边框缺口式旋转加载器。缩小为 18–23px，仅实际忙碌时显示；遵循减少动态效果偏好，旁边持续显示文字状态。 |

以上原始片段的未修改快照以 .html.txt 保存在 docs/design-references/galaxy。仓库 MIT 许可完整副本位于 public/licenses/galaxy-MIT.txt，随站点构建分发。

## 设计落点

- src/ui/controls.tsx：统一主操作按钮、忙碌反馈和加载状态。
- src/ui/galaxy-controls.css：限定学习工作区与设置弹窗的组件样式。保留暖白、橙色、思源黑体，统一按钮、表单、选择器、复选框、进度、通知和焦点。
- 用原生控件承载语义和键盘行为；危险操作仍走原有确认；隐藏输入与文件拖拽逻辑没有改写。
- 导入区去掉纸张立体装饰、光斑和网点背景，换成上传图标、简洁底色与明确拖拽反馈。课程封面改为平面图片，去掉书脊、反光、鼠标跟随倾斜和多层阴影。
- 登陆与品牌介绍页不在本次样式作用域内。没有使用霓虹、光晕、粒子、自动闪动、背景动画或无限循环的装饰加载器。

本次保留页面结构与业务逻辑；API 配置、课程资料、复习安排和作答不因外观更新而重写。

## 最终验证与运行状态

已通过：

- Galaxy 组件专项：正常动效与减少动效、滑动指示位置、忙碌时禁用、防重复操作、原生单选键盘行为、禁用复选框语义，以及 320/390 手机布局。
- 导入：11 组真实应用场景、4 个布局检查；覆盖明确点击开始、顺序上传、混合格式、重复文件、错误重试、待分类确认、跨页归属与删除同步。调整了旧脚本中工作台标题、手机导航、资料管理菜单选择器，使检查对应当前页面。
- 复习规划：15 个流程、24 个布局；修正测试数据在周四会覆盖唯一休息日的问题，保留原有休息日断言，算法未变。
- 整组练习：4 组交互、9 个布局；设置：3 组交互、15 个布局；整卷模拟 App 流程回归通过。
- TypeScript、生产构建、组件设计检测通过。正式构建也通过 Galaxy 专项测试。
- 用户本机实图：test-results/galaxy-ui/live-import.png、live-courses.png、live-settings.png。已通过 CUA 核对实际课程入口、16px 模型表单、视觉模型切换与页面宽度，没有改写真实课程或 API 配置。

运行预览：当前使用已运行的 http://localhost:3001/ 展示构建产物。Vite 5174 未在 5 秒内响应；已将 optimizeDeps.entries 限制为 index.html，避免把组件参考和导出 HTML 当作应用入口。尝试重启 Vite 的命令被自动审批策略阻止，未停止该进程，改用已有本机服务继续交付。

没有计为通过的补充回归：studio-document-ui-smoke 在等待 PDF 预览 iframe 时 45 秒超时；该检查已连续两次出现，当前尚未定位，不把文档排版链路报告为通过。旧 workspace-ui-smoke 仍针对已替换的 CourseWorkspace 组件，其选择器不适用于当前 CourseStudio，未据此声称当前工作台通过。课程入口、导入跨页处理、实际课程 UI 与专项组件检查均有独立验证。
