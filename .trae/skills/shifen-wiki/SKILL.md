---
name: shifen-wiki
description: 将已摄取资料消化为带真实引用和双向链接的 Wiki，并执行索引问答与 Lint。用户要求生成讲义、整理考点、查询知识库或修复镜像时使用，不用于修改 Raw 原件。
---

# 考谱 Wiki 消化

只调用当前用户工作区的考谱 API。运行时真源是后端 JSON，Markdown 是可再生镜像；不要手工编辑镜像来持久化数据，也不要改写 `knowledge/_raw`。

可执行入口为 `node .trae/skills/shifen-wiki/run.mjs`：
- 消化讲次：`analyze '{"lessonId":"讲次ID","mode":"ai","autoPublish":false}'`。
- 刷新文件树：`sync`；执行 Lint：`lint '{"repair":false}'`。
- 登录态命令行调用同样使用 `SHIFEN_COOKIE`，不要记录或输出其内容。

## 消化与同步

1. 用 `GET /api/lessons/:id` 确认字幕、文字或板书来源已经存在。需要分析时调用 `POST /api/lessons/:id/analyze`，正文为 `{ "mode": "ai", "autoPublish": false }`；无文字模型时明确报告，或按用户选择使用 `extractive`，不得冒充 AI 结果。
2. 轮询讲次直到终态。AI 中途失败时保留 Raw、字幕、关键帧和检查点，使用相同来源与模型重试 `/analyze`，不要重复已完成分块。
3. 用 `GET /api/knowledge/tree?refresh=1` 同步并读取课程索引。用 `GET /api/knowledge/file?path=<树中的真实路径>` 阅读相关 Wiki；路径必须来自文件树，不拼接未验证路径。
4. 确认结构化笔记保留 cue、chunk、frame 引用及 `[[笔记名]]` 双向链接。关键帧只通过 `/api/knowledge/asset?path=<真实资源路径>` 读取。

## 索引问答

调用 `POST /api/knowledge/query`，正文为 `{ "courseId": "...", "question": "...", "save": false }`。服务会先读课程索引，再检索相关 Wiki。只使用响应 `citations` 中的真实 noteId、path、cueIds、chunkIds、frameIds 作答；没有引用时说明依据不足。只有用户确认保存有价值问答时才设 `save: true`。

## Lint 与修复

1. 调用 `POST /api/knowledge/lint`，正文 `{}`，报告 Raw hash、断链、孤儿页、缺失资源、陈旧索引和 stale Output。
2. 只有需要重建可再生镜像时才传 `{ "repair": true }`。修复后重新读取文件树并再跑一次 Lint。
3. Raw 缺失或哈希错误不能靠 repair 修复；停止生成依赖该来源的新结论，并提示从原始来源重新摄取。
