# 课程工作台：资料、对话与笔记产物

更新：2026-11-05。

`server/course-studio.mjs` 独立实现课程内的多资料通读、笔记整理、课程对话与笔记修订。它复用已经配置的文字模型，不是新的模型服务，也不包含模型密钥。

## 挂载和生命周期

在现有账户保护之后挂载：

```js
const courseStudio = mountCourseStudio(app, {
  getState: () => state,
  saveState: save,
  provider,
  fetchImpl: studioFetch, // 可选，测试注入；默认 fetch
});
```

本模块监听 `shifen:close`，停止时取消本机任务。父级删除课程时在最终保存前调用 `courseStudio.removeCourse(courseId)`；清空学习空间时调用 `courseStudio.reset()`。它们不自行保存，由父级和其余数据变化一起保存。

持久数据在 `state.courseStudio = {version:1,messages,artifacts,jobs}`。建议普通 `/api/state` 不包含此大对象，课程页单独获取。模型密钥、运行时 AbortController 和配置快照不写入状态。服务重新启动会把未结束任务标记为中断，保留用户指令，不假装任务仍在后台继续。

## 接口

| 方法与路径 | 请求或结果 |
| --- | --- |
| GET `/api/course-studio?courseId=…` | `{configured,messages,artifacts,jobs,limits}`；当前课程消息与全部笔记产物、活跃任务和最近20条结束任务 |
| POST `/api/course-studio/jobs` | `{courseId,documentIds,prompt,action,artifactId?}`；返回202和任务对象 |
| GET `/api/course-studio/jobs/:id` | 读取任务真实阶段和完成结果 |
| DELETE `/api/course-studio/jobs/:id` | 取消未结束任务；保留指令与原资料 |
| GET `/api/course-studio/artifacts/:id/export` | 下载带来源索引的 Markdown 笔记 |

`action` 为 `notes`、`chat`、`revise`。`prompt` 为1–6000字符。通常 `documentIds` 为1–20个不重复、本课程已就绪资料或笔记ID；修订时需提供本课程已有 `artifactId`，可传空数组以复用原来源，也可加选资料。修订会额外通读完整旧稿（真实章节号和片段位置），以支持“第二节有误”等指令；旧稿也计入24万字符与400处理单元的总量限制，超限明确拒绝而不省略。`sourceDocumentIds` 不自动累计每一代旧稿，另用`coverage.contextDocumentCount`记录旧稿上下文数量。修订创建新的笔记和MD资料，旧版本保留。

任务结构为：

```js
{
  id, courseId, action, documentIds,
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  phase, message, completed, total, createdAt, updatedAt,
  artifactId?, assistantMessage?, error?
}
```

`completed/total` 表示实际处理阶段数量，不是知识掌握率、识别准确率或估算秒数。多批整理在生成目录后才知道最终合并组数，因此 `total` 可增加。运行时每门课最多一个任务，全服务最多同时两个。

消息为 `{id,courseId,role,content,documentIds,createdAt,jobId,artifactId?}`；对话回答还带 `sourceRefs`。

笔记产物为 `{id,courseId,kind:'notes',documentId,title,body,sourceDocumentIds,sourceRefs,coverage,revision,createdAt,updatedAt,needsReview:true,warning,previousId?,status}`。状态 `ready/stale` 由读取时核对原来源决定，来源改写或移除时不把旧笔记伪装成当前结果。旧笔记仍可下载，但不能直接用过期来源修订。

`sourceRefs` 每项由服务端绑定 `{id,documentId,documentName,chunkId,page,locationKind,text,offset?}`，正文段末 `[来源 s1、s2]` 对应这些ID。位置是原资料页、段或幻灯片，不能把DOCX段号冒充原始页码。

生成笔记同时新增本课程 `MD` 文档：`origin:{kind:'ai-notes',artifactId,sourceDocumentIds,revision}`，以兼容资料选择、检索与既有按documentIds出题。结构块保留完整章节，检索chunks带重叠上下文；显示完整笔记应优先使用artifact.body或structure.blocks，不能把重叠chunks直接拼起来当正文。

## 通读与去重方式

单次最多20份资料、24万原文字符、400个处理单元，超过时在付费调用前明确拒绝。单个较长原文片段按连续9000字符分开，保留同一原片段ID与位置。原解析器重叠片段保持来源可追溯，交由整理步骤合并重复；不按首尾节选、不悄悄只读前几页。

1. 每批最多约1.8万原文字符通读，要求保留定义、成立条件、公式、推导、方法及原课例题。
2. 一个批次可直接形成笔记。多个批次先生成只负责分组的目录，目录必须完整、无重复地对应全部中间章节。
3. 每组再拿到完整中间正文合并重复知识点，不拿目录短摘要代替详细正文。每组过长则继续分段，不强行塞进同一次模型调用。
4. 最终所有来源ID必须得到覆盖，才同时保存完整笔记产物和课程资料；任何批次失败都不交付一份貌似完整的半成品。

`coverage` 中的 `complete` 表示全部所选文本已送入这一流程且引用映射完整；它不证明每个事实都被模型正确保留。模型可能遗漏细节或理解错误，正文仍标识AI整理稿，需要学生核对。矛盾来源、模糊公式与疑似错误按指令保留“待核对”，不自动把推测改写成标准答案。

对话先通过同一通读阶段形成有来源的材料笔记，再生成回答；这部分中间材料不保存为笔记产物。历史对话仅提供最近6条短上下文，当前所选资料独立处理。资料整理结果超过对话预算时明确报错，不静默截去后半段。

## 状态与边界保护

- 模型配置在提交时快照；非枚举密钥getter也明确读取，任务中途更换配置不会把旧密钥发送给新地址。
- 只接受HTTPS远程模型或本机HTTP兼容端点，禁止重定向；响应、单次请求和整体任务都有上限。
- 每次阶段提交和最终保存前核对课程名称、资料正文/结构/归属/修订快照和数据集身份。资料被改写、转科、删除，或学习空间重置时，旧任务不能迟到保存到新数据。
- 取消支持不理会AbortSignal的上游请求；取消后晚到结果不会形成产物。
- 任务消息不回显原始上游错误、认证信息或密钥。模型输出若包含当前密钥也会拒绝。
- 用户输入、原文及历史消息作为不可信材料传递，不执行其中代码，不运行外部URL指令。
- 完成笔记或回答时一次保存产物/文档/消息/结束任务；保存失败回滚内存对象。

## 验证

`node --test tests/course-studio.test.mjs` 本次15/15通过。覆盖真实HTTP任务流程、笔记文档再利用、课程对话、修订版本保留与完整旧稿上下文、全部多资料发送、来源覆盖校验、单批失败无半成品、来源变化与重置隔离、取消、非枚举密钥快照、超时/长度/拒绝/密钥回显、重定向、保存失败回滚、服务重启和课程移除。测试模型为可控适配，不代表真实模型质量或所有课程的总结准确率；真实联调由应用验收另行记录。
