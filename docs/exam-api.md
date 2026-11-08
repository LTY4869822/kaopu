# 智能组卷、历年卷仿真与答卷API

2026-11-05实现。此模块为考谱独立实现，沿用已有有证据练习的固定契约与错误保留原则，不安装另一套教学平台运行时。`server/exams.mjs`由`server/index.mjs`在账户守卫之后挂载；浏览器类型契约见`src/exam-types.ts`。

## 数据和评分边界

私有存储为`state.exams={version:1,templates:[],papers:[],attempts:[]}`，完整学习导出可保留，公共`/api/state`剔除该对象。公共试卷和未交卷答卷仅返回题面、选项、分值和来源类型标签；不带答案键、可接受答案、rubric、讲解、提示或原文引文。交卷后才返回完整反馈。讲练模式可主动请求分层提示，服务端先保存帮助标记，再返回提示及来源。

单选、多选、判断用固定选项ID确定性匹配，多选比较去重后的集合；多选不设未经确认的部分分。填空精确匹配可接受答案时给参考分；非精确答案保留待核对，不能据字符不一致就判数学错误。填空保留大小写、数学符号和NFC结构。简答和计算/证明均不自动给分，只展示原文、参考过程和评分要点；学生可另记自评和错因。所有新试卷结果均不直接更新课程掌握度。

结果的`objectiveEarned / objectiveTotal`是已自动核对部分的参考分；`pendingPoints`单列，二者不能合并成虚构总成绩。`objectiveTotal + pendingPoints = totalPoints`。帮助或同卷已见答案的再次练习不视作独立证据；即使另一个讲练答卷在本次限时答卷开始后才查看答案，交卷也会合并暴露记录。

## 组卷配置

`ExamSection`：

```json
{"type":"single-choice","count":8,"points":2,"difficulty":"medium","topics":["链式法则","乘积法则"]}
```

题型为`single-choice | multiple-choice | true-false | fill-blank | short-answer | calculation`。计算题可含证明。难度`easy | medium | hard`是生成约束和估计标签，不是实测题目参数。每个分组有`count`题，每题`points`分；1–12个分组，单卷1–100题，总分不超过2000分，分值按0.5分递增，考试时长5–360分钟。资料只能选同课程、已读取完成的0–40份；材料模式至少1份，有意选择AI扩展模式才允许无资料。

`POST /api/exams/papers`：

```json
{
  "courseId":"math","title":"导数专项自测","durationMinutes":25,
  "goal":"balanced","focus":"复合求导与适用条件",
  "sourcePolicy":"materials","documentIds":["lecture-1"],
  "sections":[{"type":"single-choice","count":4,"points":2,"difficulty":"medium","topics":["链式法则"]}]
}
```

`goal`为`pass | balanced | excellent`。`sourcePolicy`为`materials | extended`；扩展题必须标记`origin:'ai-extension'`，没有原文支持则无伪造引文。普通材料题标`material-based`且至少一条逐字引文。全部题目仍需核对参考答案。

接口立即202返回`{jobId}`。`GET /api/exams/jobs/:id`返回`ExamJob`：`status`为`queued | generating | completed | failed | cancelled`，有`completed,total,message`，成功时有`paperId`。`POST /jobs/:id/cancel`取消；同课程一次只能有一个活跃组卷任务，服务最多同时生成两份。模型每批最多4题，按槽位严格验证题型、难度、题数、答案结构、来源；每批最多修复一次，整卷全部通过才原子入库，不保留半卷。最多保留100个任务状态、200份试卷和2000份答卷。任务状态在内存，服务重启后需重新读取已保存试卷库；未完成任务不能伪装成成功。

`GET /api/exams?courseId=...`返回`{configured,templates,papers,attempts,jobs}`，courseId可省略；返回的是摘要。jobs返回筛选课程的所有活跃任务与最近创建的5个结束任务，整体按创建顺序从新到旧排列。它仅含公开任务字段，不包含控制器、资料、模型payload等内部内容。浏览器刷新、本机标记丢失后可从该列表恢复活跃任务轮询；失败消息保留可读原因。任务本身仍不跨服务重启持久化。`GET /api/exams/papers/:id`返回完整公共题面。

## 历年卷分析和确认

通过现有`POST /api/documents`上传本课真题，或选择课程中已有的原卷资料，再调用：

- `POST /api/exams/templates/analyze {courseId,documentIds}` → `ExamTemplate`，`confirmed:false`。
- `POST /api/exams/templates/:id/confirm {title,sections,durationMinutes,focus}` → 已确认模板，可反复编辑确认。
- 组卷请求增加`templateId`；分组结构和时长必须与已确认模板一致，修改后应先再次确认。title/focus可个性化。

分析独立使用最多200个文字片段、90000字符。`sourceCoverage`含`sampledChunks,totalChunks,sampledCharacters,truncated`，统计实际可读片段；单片超过1800字符也可能被截断，因此即使片段数全覆盖，仍可能`truncated:true`。模板只依据可见文字，不证明整卷图示或未识别题完整；题量、分值和方向需由学生对照原件确认。模板最多分析200题；超过100题可确认后拆成不同练习卷，不静默缩水。

生成使用资料内容相关性排序，查询包括本次focus、分组topics和模板方向；仍有40片段/42000字符引用预算，不能据此宣称全课程覆盖。仿真仅借用题型结构、数量、估计难度和方向；拒绝题面与原卷所采样文字中完整相同的题，也拒绝近期本课题库中规范化后重复的题面。字面检查不证明语义新颖或改编难度相等。

分析和组卷均检查课程、来源指纹及状态版本。模板在组卷期间被重新确认修改会使本轮失败，避免旧结构绑定到新模板。资料移动、重新解析、删除，课程重命名或空间重置会使关联试卷/答卷失效或清理，并取消活跃任务。

## 作答、保存和交卷

- `POST /papers/:id/start {mode:'exam'|'practice'}` → `ExamAttempt`；同卷同模式若已有未交答卷，直接恢复该答卷。exam有`deadlineAt`，practice无截止时间。
- `GET /attempts/:id`恢复答卷，含公共`paper`及当前`answers,flaggedQuestionIds,helpedQuestionIds,revision`。
- `PATCH /attempts/:id {revision,answers,flaggedQuestionIds?}`保存完整答案映射。revision不匹配返回409，不覆盖另一操作保存的内容。
- `POST /attempts/:id/submit {revision,answers,flaggedQuestionIds?}`交卷；已交卷重复调用直接返回原结果，不新增成绩。

答案为`Record<questionId,string|string[]>`：单选用`A/B/C/D`，多选用不重复选项ID数组，判断用字符串`true/false`，填空/简答/计算用字符串。可留空字符串或多选空数组。拒绝跨卷题号、非法ID及重复多选ID。

exam截止后，PATCH拒绝修改。到期交卷仅采用截止前已保存答案，忽略提交请求带来的迟到编辑；仍要求当前revision。客户端应跳过到期PATCH，使用最近服务端revision交卷，遇409先重新读取答卷。服务端不依赖浏览器倒计时决定截止。

已交卷详情含`results`和`summary`；每题结果含`status,earned,points,expectedAnswer,answerKey,rubric,explanation,steps,sources,helpUsed`。`status`为`correct | incorrect | ungraded | unanswered`，`earned:null`表示尚无可靠分值，不是0分。主观题即便学生自评正确也不自动转为确定评分。

## 分层提示、错因和复练

`POST /attempts/:id/hints {questionId,level:1|2|3}`只允许未交卷的practice答卷：前两层分别为方向和下一步，第3层可完整解析；返回`{questionId,level,text,sources,attempt}`。保存帮助标记失败时不会返回提示。exam交卷前拒绝提示请求。

`PATCH /attempts/:id/review {questionId,selfAssessment?,reason?,note?}`只允许已交卷：自评`correct | partial | incorrect`；错因`concept | condition | method | calculation | memory | time`；备注至多1000字。自评保存在独立review，不覆盖确定判分与参考分。

错题复练在组卷配置加`retryFrom:{attemptId,questionIds}`。答卷必须已提交且同课程，题号必须来自该答卷。所选知识点进入新卷槽位，并排除原卷及已有题面；题型、数量等仍按新配置生成，来源和范围仍校验。可另用现有`POST /api/cards`收进记忆卡。

## 模型契约与验证

`exam-template`请求含`course,sources,limits`，返回`title,durationMinutes,focus,sections,sources:[{sourceId,quote}]`。

`exam-questions`请求含`course,slots,sources,sourcePolicy,focus,goal,previousPrompts,referenceStyle?`。slot为`{id,sectionId,number,type,points,difficulty,topic}`。返回`{questions:[{slotId,type,topic,difficulty,prompt,options,answerKey,expectedAnswer,acceptedAnswers,rubric,explanation,steps,hints,sources,origin}]}`。选择题ID按A至F顺序稳定；判断键为true/false；无选择项的题`options:[]/answerKey:null`。`hints`严格两条；`steps`1–8条。来源quote必须是传入sourceId文字中的连续原文。修复任务名`repair-exam-template/repair-exam-questions`，payload.original带原请求。

为避免模型重抄数学符号、标点时误改原文，模板分析与组卷的每个source另附服务器预选的`citations:[{id,text}]`。模型优先返回`{sourceId,citationId}`，服务端仅在该source的候选中精确查ID，再回填真实连续原文。每source最多4条、每条至多200字符、每source候选共至多600字符；全池候选独立限制12000字符，不因全文长度重复放大。旧`{sourceId,quote}`仍兼容并逐字核对；若两种字段同时给出，quote必须与编号原文完全一致。不存在ID、跨source挪用ID和改写quote均拒绝，不使用模糊相似度、大小写折叠或数学字符替换。每题原始引用列表仍最多4条；先逐条验证全部内容，再按`(sourceId,最终原文)`幂等去重，同一个chunk中的不同真实引文允许同时使用。重复条目中夹杂非法编号时仍整批拒绝，不会因去重跳过校验。候选字段仅用于模型传输，不保存在公共试卷或未交答卷；交卷/请求提示后只返回已核对原文。该机制保证引文来自原文，不证明题目答案在语义上正确。

模型调用固定到用户已配置地址，远程HTTPS、本机可HTTP；禁止重定向，默认单次90秒deadline，可注入更短测试deadline；响应最多512KiB，模型内容最多120000字符。资料、题面、模型输出都作为文本/JSON处理，没有eval、任意路径、外部工具或代码执行。错误脱敏，密钥不进入提示、任务消息或客户端。

运行`node --test tests/exams.test.mjs tests/exam-review.test.mjs tests/exam-integration.test.mjs`，截至引文编号和任务恢复协议修复后35项通过。测试覆盖混合题型、模板确认/变更fence、100题整卷、分析抽样覆盖、取消/重置迟到响应、单批修复、真实来源、秘密隐藏、辅助标记先保存、并行答卷已见答案、到期冻结、revision冲突、幂等交卷、主观分单列、自评另存、持久化、保存回滚及根应用认证/上传/级联链；另验证六题型和模板的候选ID回填、Unicode数学原文不变、候选预算、无泄露、无效/跨source编号及相互矛盾quote拒绝，以及任务列表课程筛选、活跃恢复、最近5项上限和公开字段白名单。增加同chunk不同引文接受、同源同文幂等去重和重复列表夹非法ID拒绝三项回归。修复错误分类后，来源字段格式错误、0条缺少证据和超过4条的数量超限会分别报错，并标明具体题号和题型；针对三种情况的有限repair回归均通过。全部模型使用虚构本地mock，未发送学生资料到第三方；真实配置模型的实际联调记录由根验收另记。

2026-11-05另执行`scripts/exam-live-model-smoke.mjs`，读取已有模型服务配置但仅在内存使用，创建系统临时学习空间及合成高数讲义（极限、连续三条件、链式法则、sin(x²)求导），未读用户教材或账号、未修改生产学习数据或模型配置。真实模型生成六题型各1题，所有题均为材料模式。初次通过时两批各触发一次有限修复，总28.9秒；修复同chunk合法多引的去重粒度后再次运行，仅2次生成请求（4题+2题）、没有repair，14.3秒通过整卷生成、逐条原文回填及交卷前答案隐藏检查。报告`test-results/exam-live-model-smoke/report.json`仅保留状态、耗时、题型计数、引文校验和安全输出形状诊断；不保留密钥、端点、用户教材或原始模型回答。此耗时为单次观察，不是性能承诺；来源校验也不构成数学答案正确性证明。

另用`node scripts/exam-live-model-smoke.mjs --seed`精确使用tempApp默认`createSeed().documents`中未经改写的`doc-math`四片段，课程math、材料模式、六题型各1、单选easy其余medium、分值5/5/5/5/10/10，以及指定的极限/连续/复合求导focus。该次25.4秒、两次生成请求且无需repair通过；六题来源数量分别2/4/2/1/1/2，均为material-based并通过逐条真实引用回填。安全报告为`test-results/exam-live-model-smoke/report-default-seed.json`，增加每题slotId/type/origin/sourceCount及修复原因诊断。不同模型调用仍可能失败；失败不会改成扩展模式或自动塞入随机引文。
