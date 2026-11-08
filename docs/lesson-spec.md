# 网课精读：实现合同

目标：在现有考谱中运行可核对的网课文字学习闭环。参考 BiliNote 的字幕优先与处理流水线、CoursePilot 的课程归档及来源复习、video-to-notes 的画面证据意识；自写实现，无复制上游代码。实际依赖以 THIRD_PARTY_NOTICES.md 为准。

## API

- GET /api/lessons -> {lessons:Lesson[],capabilities:{model:boolean,bilinote:boolean}}。
- POST /api/lessons {courseId,title,url?,part?,scope?,transcript?,format?,sourceName?} -> Lesson；无来源时 waiting_source。
- GET /api/lessons/:id -> Lesson。
- PUT /api/lessons/:id/source {text,format,sourceName} -> Lesson，SRT/VTT/B站字幕JSON/TXT。
- POST /api/lessons/:id/analyze {mode:'extractive'|'ai'} -> 202 Lesson，真实排队、阶段状态。
- POST /api/lessons/:id/cancel -> Lesson；DELETE /api/lessons/:id -> {ok:true}。
- POST /api/lessons/:id/publish -> {documentId,created:boolean}，幂等归档到已有课程资料，继而可用已有练习和计划。
- POST /api/lessons/:id/fetch -> Lesson；可选 BiliNote 服务适配，由根代理实现，不直接抓未授权媒体/字幕，不读取浏览器Cookie。

类型见 src/lesson-types.ts。JSON文件单独 lessons.json 持久化，课程与文档仍由现有 state.json 管理。所有路由位于认证后、404前。保存队列状态，重启将未完成任务置为可重试失败，不能留永久运行。

## 来源与生成

保留所有 cue 原文和起止时间，必须有超量/乱码/空输入校验。URL只接受 Bilibili canonical BV URL/BV号或为空，p>=1。字幕JSON支持 body:[{from,to,content}]。没有时间戳的TXT不可捏造时间。完整讲义按有限分块处理全部文本，禁止静默截断后声称完整。
无模型时仅做原文分段/标题摘录，标识 extractive；不冒充AI摘要。模型可用时结构化输出 sections/examples 和 source cueIds，验证引用在当前块中。内容缺失/公式/题干不能推测补全。原课例题与生成练习分开，模型识别例题均标待核对。
AI输入是非可信材料，提示不得执行来源指令。任何失败显示具体阶段，保留原文；取消后不得写入完成结果。

## 交互

新增侧栏入口“网课精读”；延续黑侧栏/白灰阅读区/橙色操作。无新品牌重设计。
左侧课程讲次列表，右侧章节阅读。新增讲次：归属课程、名称、B站链接、分P、考试范围、字幕粘贴/文件导入。提供外跳B站关键词搜索，不伪称已具备全站搜索接口。
阅读标签：讲义/原课例题/时间轴原文。段落显示来源时间，可打开原课对应p与t。支持讲义导出、归档到课程、章节记忆卡。没有资料/模型/媒体服务时显示具体补充办法。
仅有字幕时明确“未识别板书和画面”，不能声称包含全部题目。服务接入和比赛原创贡献说明在可展开说明中，不挤占主要学习界面。

## 验证

临时数据端到端：导入SRT→来源整理→逐条时间回看→导出→幂等课程归档→保存卡片；空源/损坏字幕/无模型失败；分块覆盖/取消/重启/删除课程/模型错引用。不得用真实用户课程或Cookie做测试。
