---
name: shifen-raw
description: 将 B 站视频、字幕和本地学习资料摄取到当前用户的不可变 Raw 层。用户要求解析链接、批量导入分P、保存字幕或核验原件时使用，不用于生成复习产物。
---

# 考谱 Raw 摄取

通过正在运行的考谱后端 API 操作，默认本机地址为 `http://127.0.0.1:3001`。沿用当前用户登录会话，不读取、打印或跨账户复制 Cookie。不要直接修改 `state.json`、`lessons.json` 或 `knowledge/_raw`。

可执行入口为 `node .trae/skills/shifen-raw/run.mjs`：
- 读取目录：`catalog '{"url":"B站链接"}'`。
- 完整导入：`import '{"courseId":"课程ID","url":"B站链接","items":[{"part":1,"title":"第一讲"}],"analyzeMode":"ai","withVisual":true,"autoPublish":true,"autoOutput":"review"}'`。
- `autoOutput` 可设为 `review`、`exam-checklist` 或 `none`。整批讲次完成并归档后只生成一份 Output；入口会等待讲次及 Output 任务结束。
- 登录态命令行调用可通过环境变量 `SHIFEN_COOKIE` 传入当前会话，不要把 Cookie 写入命令参数、日志或文件。

## B 站链接

1. 用 `GET /api/lessons` 确认来源、文字模型和画面能力。用 `GET /api/lessons/bilibili?url=<编码后的链接>` 读取真实分集目录；不要让用户安装 Python、yt-dlp 或 whisper 作为默认前置条件。
2. 用 `POST /api/lessons/import` 导入，正文包含 `courseId`、规范化 `url`、`items: [{part,title}]`、`scope`、`withVisual`、`autoPublish`。单批最多 20 集。
3. `autoPublish` 必须显式传布尔值；为 `true` 时必须同时传 `analyzeMode: "extractive"` 或 `"ai"`。需要连续产出时传 `autoOutput: "review"` 或 `"exam-checklist"`，它要求 `autoPublish: true` 和已配置文字模型。只有用户要求画面且服务具备真实抽帧能力时才设置 `withVisual: true`。
4. 轮询 `GET /api/lessons/:id`，直到完成或失败。已存在的同课程、同 BV、同分P会进入 `skipped`，不要重复创建。

## 本地资料与文字

- PDF、DOCX、PPTX、TXT、Markdown 和图片使用 `POST /api/documents` 的 multipart 上传，字段为 `courseId`、`file`，需要时传 `parseMode`。
- 粘贴字幕或讲解文字使用 `POST /api/lessons`，传 `courseId`、`title`、`transcript`、`format`、`sourceName`；已有讲次可用 `POST /api/lessons/:id/fetch` 重新获取来源。
- 不要伪造本地下载、转写或视觉识别结果。公开字幕不可用时报告后端错误，并说明可选能力尚未配置。

## 完成核验

- 检查讲次的 `rawRef`、`rawRefs`、`rawMetadataRawRef`，视频启用时检查 `mediaRawRef`，关键帧检查 `visual.frames[].rawRef` 与 `sha256`。自动 Output 检查整批讲次共同的 `outputJobId` 和可能的 `outputError`。
- 失败时报告 `failedStage`、`error` 和 `retryable`。按失败阶段使用 `/fetch`、`/analyze` 或 `/visual` 重试；不要重新下载已成功归档的来源。
- 用 `POST /api/knowledge/lint`，正文 `{}`，核验 Raw 哈希。Raw 原件不可变，Lint 的 `repair` 只允许重建镜像，不能用来覆盖原件。
