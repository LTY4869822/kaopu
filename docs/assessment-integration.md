# 有证据练习集成契约

本模块是受 DeepTutor 的证据/答案契约与未评分状态设计启发的原创 Node 适配；没有安装、运行或嵌入 DeepTutor，也不复制其 agent 平台。它与旧 `questions/attempts` 完全分开。已用临时 Express 服务和虚构材料/mock 模型测试，未把真实资料发送到外网。

## 挂载与状态

```js
import { mountAssessment } from './assessment.mjs';
const assessment = mountAssessment(app, {
  getState: () => state,
  saveState: save,
  provider: modelService.provider,
  recordOutcome: ({ courseId, correct }) => {
    const course = state.courses.find(item => item.id === courseId);
    course.mastery = updateMastery(course.mastery, correct, 'medium');
  },
  // fetchImpl 可注入 mock；生产省略。timeoutMs 仅可设 1..120000，默认 45000。
});
```

在现有 owner guard、JSON body parser 后挂载。`saveState` 与 `recordOutcome` 必须同步；后者只应修改本次 course.mastery，不发网络请求或产生其他外部副作用。保存失败会恢复 assessment 状态及该课程先前的 mastery。

持久化为 `state.assessments = { version: 1, questions: PrivateQuestion[], attempts: Attempt[] }`。**`/api/state` 必须移除此字段**，备份导出可保留。不可直接把私有 questions 合并进旧 questions 或在前端序列化，私有内容包括 answerKey、expectedAnswer、acceptedAnswers、rubric、解析及指纹。

删除/移动/重新解析资料时调用 `assessment.pruneDocument(documentId)`；删课时调用 `pruneCourse(courseId)`；清空/重置 state 后调用 `reset()`。这些 helper 只变更 `getState().assessments`，级联删相应作答且使进行中的请求失效，**由调用者随后 save()**。它们不删除资料、不逆算过去已累计的 mastery。

course 的 id/name 与完整源 document/chunks 有版本指纹；内容、页码、bbox、归属、名称等变化后，旧题提交返回 409，GET 列表隐藏失效题与关联作答。mastery、考试日期和目标分变化不使题失效。对人工导入/修改的私有契约也校验内容指纹。

## HTTP API

生成/提交成功均为 HTTP 200。错误统一由应用现有 error handler 输出 `{error:string}`。400 输入无效；404 课程/题不存在；409 并发或来源/契约变化；422 资料不足/上限；503 未配模型/服务忙；502 上游或题目校验失败；504 超时。每次模型调用默认 45 秒，标准生成两次调用，最多共享一次修复调用；前端应允许取消并保留原列表。

### GET /api/assessment?courseId=calculus

`courseId` 可省略以列出全部有效题；指定时必须是实际存在课程。响应：

```json
{
  "configured": true,
  "questions": [{
    "id": "assessment-uuid", "courseId": "calculus", "type": "single-choice",
    "topic": "链式法则", "prompt": "根据讲义，复合函数应如何求导？",
    "options": [{"id":"A","text":"只对外层求导"},{"id":"B","text":"外层导数乘内层导数"},{"id":"C","text":"取倒数"},{"id":"D","text":"恒为零"}],
    "difficulty": "medium", "createdAt": "2026-11-04T00:00:00.000Z", "version": 1,
    "generationMode": "evidence-ai",
    "sources": [{"documentId":"lecture-1","documentName":"导数讲义.pdf","chunkId":"chunk-1","page":3,"locationKind":"page","text":"复合函数的导数等于外层函数的导数与内层函数导数的乘积。","bbox":[10,20,300,90],"blockId":"block-1"}]
  }],
  "attempts": []
}
```

题型仅 `single-choice` / `short-answer`，难度为 `easy|medium|hard`；简答 `options:[]`。source.text 是已核对的真实连续引文，其他字段从服务端 chunk 拷贝，不采用模型编造的 document/page。bbox/blockId 可选，locationKind 支持 page/section/slide/timestamp。公共题目在任何时候都不返回标准答案、rubric、解析、私有指纹；只有已提交 attempt 可返回解析。

### POST /api/assessment/generate

```json
{"courseId":"calculus","count":3,"types":["single-choice","short-answer"],"focus":"链式法则与易错因子"}
```

`count` 默认3、1..6整数；types 默认两类、不能重复；focus 可空、最多500字。没有文字模型返回503及模型设置指引，**不会退化成伪 AI 题**。返回 `{questions:PublicQuestion[], warning:string}`。

服务端最多选24个真实 chunks、累计24000字符，每段最多1800字符，按资料轮流取样；focus 仅做轻量相关性排序。先生成不同知识点的蓝图，再按固定蓝图出题。校验数量、题型、选项/答案键、固定 rubric、参考答案、解析、逐字原文引文与重复题面。最多修复一次；整个 batch 通过才入库，否则不保存任何题。相似改写/答案语义正确性并未被程序证明，warning 会明确答案与推导需核对。

### POST /api/assessment/attempts

```json
{"questionId":"assessment-uuid","answer":"B","helpUsed":false}
```

单选 answer 只能是稳定 ID A/B/C/D，不用数组下标或选项文本。简答 answer 为1..10000字。查看原文/提示时，前端应将该题 `helpUsed` 置 true 并在提交时带上；同题任何已有作答后的重答均不再累计掌握度。

```json
{
  "id":"assessment-attempt-uuid", "attemptId":"assessment-attempt-uuid",
  "questionId":"assessment-uuid", "courseId":"calculus", "answer":"B",
  "status":"correct", "confidence":1,
  "feedback":"所选选项与已保存的参考答案一致。请结合原文核对理解。",
  "expectedAnswer":"B. 外层导数乘内层导数", "explanation":"依据讲义的复盘解释",
  "steps":["识别内外函数","外层导数乘内层导数"], "sources":[],
  "counted":true, "correct":true, "helpUsed":false, "createdAt":"2026-11-04T00:01:00.000Z"
}
```

`sources` 实际返回该题已验证的源引用，示例为省略细节写空。status 为 `correct|partial|incorrect|ungraded`；correct 仅在 correct/incorrect 时存在，partial/ungraded 不冒充布尔错误。confidence 为0..1或null；它是模型自报程度，不是准确率。expectedAnswer/explanation/steps 在本次提交完成后可见。

- 单选按保存的稳定答案 ID 确定性判分；仅该题**首个作答且未用帮助**调用一次 recordOutcome，counted=true。
- 简答先做保留数学符号与字母大小写的 NFC/空白精确归一，比对 acceptedAnswers；其他答案才调用固定 rubric+参考答案+源原文的模型反馈。
- **所有简答均 counted=false**，包括精确匹配、模型高置信正确或错误；模型自报置信不直接改变 mastery/FSRS。confidence<0.8、JSON无效、服务失败或未配置模型都保留 ungraded，不发明半分。
- 同题并发请求返回409；保存前再次校验课程、所有引用文档和题目契约。最多2000题、10000作答，不静默删除旧记录。

### GET /api/assessment/attempts?courseId=calculus

返回 `{attempts:PublicAttempt[]}`，字段与 POST 返回一致。基础 GET 也带同样列表。错题页可筛 status=incorrect/partial，另列 ungraded；不要将未评分当错题或完成掌握。没有实现可自动逆算掌握度的 review 接口。

## Mock fixture 与验证

`tests/assessment.test.mjs` 文件头的 `seed()`、`blueprint(payload)`、`questions(payload)` 是完整虚构 fixture。mock 从模型请求 `body.messages[1].content` 解析 JSON：task 为 `blueprint`、`questions`、`repair-blueprint`、`repair-questions` 或 `grade`。修复任务的原 payload 位于 `original`。grade 请求携带固定 questionContract 与独立 answer。

运行 `node --test tests/assessment.test.mjs`。覆盖公共/私有隔离、真实引文、跨课/假页码/重复/错键拒绝、有限修复与batch原子性、低置信/错误JSON未评分、确定性首答计数、短答不计分、版本变化/并发保护、删除级联、重载幂等、超时/重定向/大小限制、密钥不回显、保存失败回滚。

安全边界：外部原文、答卷、模型输出全为文本/JSON数据；无工具调用、eval、shell、源网址访问。HTTP只请求用户已配置的模型地址，沿用model-service地址规范（远程HTTPS/本机HTTP），禁止重定向；响应按字节流限256KiB，模型文本限64000字符、每次调用有deadline。来源查真与结构检查不能证明科学计算答案正确，也不承诺prompt注入无法影响模型语义；因此短答不累计掌握度，数学结果需人工核对/未来独立计算校验。
