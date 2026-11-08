# 内部 UI 改版参考

2026-11-04。用户否定现有内部 UI，要求从设计网站挑选更好的案例，并提供 Good Fella 黑橙字符人像网站截图。此文件先记录候选与建议，随后用户以「OK按照你的想法来」确认了内部改版方向，实施规格见 internal-ui-spec.md。

## 品牌参考

- Good Fella：https://good-fella.com/
- 已实际打开并查看首页，与用户截图同源。黑底、白色大字、橙色操作、字符人像构成视觉识别。
- 已阅读 clone-website skill 及 inspection-guide；后续复刻须观察真实滚动、悬停、菜单及移动端状态，不能由静态图推断动画。当前只完成视觉参考筛选，没有宣称完成交互复刻。

## 内部页面候选

### 1. Ronas IT：Online Course Student Dashboard（主视觉首选）
- 来源：https://dribbble.com/shots/26411864-Online-Course-Student-Dashboard
- 图：https://cdn.dribbble.com/userupload/44541463/file/ae55ec33960a1673fc07f6c477b425fd.png
- 已查看原图：白底与黑、橙、蓝色块课程卡；简洁侧栏和醒目主要操作。
- 用于我的课程：继承强对比与完整卡片视觉，结合既定封面网格；避免额外统计、欢迎大卡挤占课程空间。

### 2. Drum'N'Code：SkillLabs — Course Lesson（课程目录结构）
- 来源：https://dribbble.com/shots/27301550-SkillLabs-Course-Lesson
- 图：https://cdn.dribbble.com/userupload/47464643/file/8b7ba165360968b0c63f863c54f374f7.png
- 作者明确说明课程目录、筛选与信息卡片。适合参考封面、标题、课程元信息层次。
- 通过搜索索引核对作者说明和图片；未验证可交互原型。

### 3. Keitoto：Skillsphere（课程内学习工作台）
- 来源：https://dribbble.com/shots/26133491-Skillsphere-E-Course-Dashboard-Saas-App-AI-Chat-Assistant
- 图：https://cdn.dribbble.com/userupload/43655675/file/original-99e45f191c9ff84f947d9c57e0d509bd.png?resize=2048x1536&vertical=center
- 已查看原图：深色课程页头，白色内容容器，左侧章节，右侧上下文 AI 讲解。
- 可转化为资料/章节导航、原文阅读与可折叠讲解区，保持较大中文字号。

### 4. Anna Helyk：Document Management App（文件组织）
- 来源：https://dribbble.com/shots/22987938-Document-Management-App
- 图：https://cdn.dribbble.com/userupload/11216557/file/original-f15bac2200b0f1d1432cf870fc5dec24.png
- 已查看原图：灰白文件区、橙色上传操作、文件类型缩略卡、网格/列表入口。
- 用于课程资料工作台的文件呈现，省略存储分析图，保留文档识别与定位。

## 建议方向

以 Ronas 的强对比与大色块建立内部视觉，以 SkillLabs 组织课程目录、Skillsphere 组织学习工作台、Document Management 组织文件。统一为中性灰白阅读表面、黑色结构和少量橙色操作，重新设计自己的课程封面，不混用四套视觉语言。

保留用户已确认流程：首页仅暂存导入 → 点击开始分析 → 创建或复用课程 → 我的课程网格 → 对应资料工作台。

这些 Dribbble 项目是设计参考，并非已验证可运行产品或可直接复制的开源实现。只使用其公开预览和来源链接进行比较，没有下载或引入第三方设计资产。用户确认后的实现包括内部黑白橙系统、原创课程封面、文件目录与阅读工作台；没有将设计稿中的静态画面宣称为原站交互。
