---
name: shifen-output
description: 复用课程 Wiki 和真实来源生成复习资料、考点清单并导出 Markdown、PDF 或 DOCX。用户要求 Output、复习提纲、考点清单或产物导出时使用，不用于摄取原始视频。
---

# 考谱 Output 产出

通过课程工作台 API 生成产物，不另写模型提示词冒充后台任务，不直接创建 Output 文件。默认后端为 `http://127.0.0.1:3001`，沿用当前用户会话。

可执行入口：`node .trae/skills/shifen-output/run.mjs generate '{"courseId":"课程ID","documentIds":["讲次归档资料ID"],"action":"review","prompt":"生成系统复习资料"}'`。`action` 也可为 `exam-checklist`；入口会轮询任务并输出最终产物 ID。登录态命令行调用使用 `SHIFEN_COOKIE`。

## 生成

1. 用 `GET /api/course-studio?courseId=<课程ID>` 读取可用资料、任务和产物。`documentIds` 只能选当前课程中已读取完成的真实资料或已有笔记，不得虚构 ID。
2. 调用 `POST /api/course-studio/jobs`：
   - 复习资料使用 `action: "review"`。
   - 考点清单使用 `action: "exam-checklist"`。
   - 正文同时包含 `courseId`、`prompt`、`documentIds`。提示词描述用户的复习目标，不要求模型编造必考结论。
3. 用 `GET /api/course-studio/jobs/:id` 轮询直到 `completed`、`failed` 或 `cancelled`。失败时保留原输入并报告 `message`，不要重复创建多个并发任务。
4. 成功后重新读取课程工作台，按任务的 `artifactId` 找到产物，核验 `kind`、`sourceNoteIds`、`sourceRefs`、`revision` 和 `status`。

## 导出与陈旧版本

- 用 `GET /api/course-studio/artifacts/:id/export?format=md`、`format=pdf` 或 `format=docx` 导出；需要浏览器内预览 PDF 时添加 `inline=1`。
- 用 `GET /api/knowledge/tree?refresh=1` 确认对应 `科目/output` 的 `r<n>.md` 已生成，并用 Lint 检查引用和陈旧状态。
- `status: "stale"` 表示来源已经变化。保留历史 revision，明确提示用户；不要覆盖旧版本或把旧产物称为最新资料。需要更新时基于当前来源新建 `review` 或 `exam-checklist` 任务。
- PDF/DOCX 导出依赖现有导出器。依赖不可用或导出失败时如实报告，不能用改扩展名的 Markdown 冒充。
