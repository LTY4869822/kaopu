# 课程资料出题与主观作答反馈

更新：2026-11-05。本轮扩展既有智能组卷，不更换题本、答卷与来源契约。

## 学生流程

1. 在课程工作台选取一份或多份资料、合并笔记，进入组卷。`ExamStudio` 支持 `initialDocumentIds`，带入选中的范围；还可以通过 `initialPaperId` 打开已有产物。
2. 配置题型、数量、每题分值和难度。生成、取消、保存与作答继续使用原有流程。
3. 客观题直接点选；主观题可以输入文字，或上传本题作答照片、PDF、Word、PPTX、TXT、Markdown。
4. 上传后先展示可编辑的识别稿；学生对照自己的原件核对后，可以采用、追加或明确替换当前文字。解析接口不自动修改答卷，失败也不清空现有答案。
5. 交卷后点击“批改主观题”，按固定题本的参考答案、评分要点与来源逐题给建议反馈。建议分与客观参考分分开显示；每题可以单独重新核对。
6. 薄弱点指向这道题的实际来源，包括作为资料使用的合并笔记。点击原文链接可回到相应文件、页或段核对。

## 接口和集成

`mountExams(app, { ...existing, parseSubmission })` 新增可选解析器注入。

`parseSubmission(file, { signal, mode })` 接收 Multer 文件，返回项目已有的 `{ chunks, structure?, warning? }`。图片和手写扫描PDF可以复用现有看图识别，普通文档走本机解析。未注入时明确返回503，可以继续文字作答。

- `POST /api/exams/attempts/:id/submission`：multipart字段 `file`、`questionId` 和可选 `parseMode`（`handwriting` / `auto`）。PDF默认手写扫描识别，最多8页；文字PDF可明确改为auto优先提取文字层。此选项仅影响PDF，照片一律看图、普通文字文档仍走本机解析。每份最多20MB；只接受当前未结束答卷的非选项题。返回 `{questionId,filename,text,needsReview:true,warnings}`。优先使用 `structure.blocks` 完整文字，避免重叠chunks被重复拼入；超过单题10000字符拒绝，不静默截断。原始附件在请求期间读取，不另存一份到资料库，学生应保留自己的原件。
- `POST /api/exams/attempts/:id/grade`：`{revision,questionIds?}`，只允许已交卷答卷。默认选择尚无AI反馈的最多10道已作答主观题，返回202 `{jobId}`。显式选择支持单题重新反馈。
- `GET /api/exams/grading-jobs/:id`：返回 `{id,kind:'grading',attemptId,courseId,status,completed,total,message}`。
- `POST /api/exams/grading-jobs/:id/cancel`：停止未完成题目，已逐题保存的反馈保留。
- 原答卷读取接口返回 `gradingJob`（本次服务仍在运行时），可找回当前进度；服务重启后瞬时任务消失，已保存的作答和逐题反馈保留，尚未完成部分可重新开始。

所有路由沿用主应用的账户保护。文件解析、生成与主观反馈均使用既有服务配置，不接受学生指定模型地址，不使用公共图床。

## 评分与来源边界

主观反馈独立保存于 `results[].aiAssessment`，字段包括 `status`、`suggestedPoints`、`maxPoints`、`confidence`、`feedback`、`weakPoints`、`sourceRefs`、`createdAt` 和 `warning`。

主观AI反馈不改写原客观 `earned`、`status`，也不改变课程掌握度。`summary.aiSuggestedEarned`、`aiSuggestedTotal`、`aiAssessedQuestions` 为独立的建议汇总；原有待人工核对分值仍保留。`weakTopics` 由服务端按题本知识点汇总客观错题和AI建议错误／部分完成的题，不把未作答自动等同为未掌握。

评分请求只使用服务端固定题干、参考答案、rubric、来源和学生保存的实际作答。模型不执行代码、访问链接或调用工具。来源只能按题本真实来源的数组编号选择，服务端回填，不能返回一条任意笔记链接。

返回结构、建议分范围、状态一致性与来源编号均校验，最多一次修复。低于0.8判断程度或无法确认时保留 `ungraded`、建议分为null；判断程度不是准确率。计算与证明题不因此获得通用数学证明，物理建模和扫描识别的疑难内容仍需对照原文核对。

每题保存前再次核对来源版本和答卷修订。来源修改、课程移除、空间重置、取消、并行修改或超时均阻止迟到反馈覆盖当前状态。中途失败时已完成的逐题反馈保留，错误不暴露提供方密钥与原始诊断。

## 验证

新增 `tests/exam-subjective.test.mjs`，15项通过：建议分与客观分隔离、来源回填、修订与题型范围、低置信待核对、伪造引用、取消与并发、旧资料防迟到保存、部分成功与保存失败回滚、附件确认前不写答案、超长不截断、缺配置与诊断脱敏；新增真实原生解析重叠复原、中文文件名解析前解码，以及重置时立即取消批改／附件提取、PDF模式默认值与合法性、额外模型topic严格拒绝与批改专用错误信息。原有三组卷／复盘／集成测试35项也通过。

真实模型与浏览器验收由主代理在隔离数据中继续执行；这里不把自动化fixture结果称为真实模型准确率。
