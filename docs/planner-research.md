# 期末复习规划助手：算法与开源参考

研究日期：2026-11-04。以下区分已在项目运行的依赖、可借鉴的方法和未来可选的求解器；研究参考不等于已集成。产品代码的最终行为应以实现和验收记录为准。

## 选型结论

当前 React + Node 本地单用户版本，适合实现可解释的滚动排期：把截止日前的每日容量作为硬约束，结合剩余工作量、最早截止日、目标、难度与复习反馈分配学习块，再把同一批任务放入可用时段。它能本地快速重算并给出缺口原因，无须引入额外 Python/JVM 服务。此判断是结合下列主源与当前部署方式作出的工程选择，不是外部研究证明的最优考试策略。

卡片继续由项目已有的 `ts-fsrs` 5.x 调度。跨课程排期消费到期信息，不修改卡片本身的到期日期。FSRS 不负责推断任意学科要学多久，也不等于考试分数预测。

## 主源比较

| 项目 | 核实到的内容 | 本项目的使用边界 |
| --- | --- | --- |
| [Google OR-Tools](https://github.com/google/or-tools)（Apache-2.0） | [CP-SAT 排班](https://developers.google.com/optimization/scheduling/employee_scheduling)与[作业车间](https://developers.google.com/optimization/scheduling/job_shop)给出容量、不重叠和先后顺序的建模方式；[官方安装](https://developers.google.com/optimization/install)提供 C++、Python、Java、C#。 | 借鉴硬约束建模。当前不添加运行时依赖，不宣称调用 CP-SAT。若以后加入大量锁定课表、章节先修关系和精确最优性要求，可独立部署求解服务。 |
| [Timefold Solver](https://github.com/TimefoldAI/timefold-solver)（Apache-2.0） | [连续规划](https://docs.timefold.ai/timefold-solver/latest/responding-to-change/continuous-planning)区分历史、已发布和草稿；[实时重排](https://docs.timefold.ai/timefold-solver/latest/responding-to-change/real-time-planning)结合变化与锁定实体。[当前介绍](https://docs.timefold.ai/timefold-solver/latest/introduction)说明 Java/JVM 技术栈。 | 借鉴滚动窗口、已完成记录固定和仅调整未来。当前不集成 JVM 求解器，也不把云平台模型视为开源依赖。 |
| [OptaPlanner / Apache KIE](https://kie.apache.org/) | 原 OptaPlanner 文档链接本次访问重定向到 Apache KIE。 | 属同类约束规划路线；本次重排方法使用可直接验证的 Timefold 文档，不依赖过期文档入口，不凭历史印象声称维护状态。 |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（MIT） | [5.2.3 包定义](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.2.3/package.json)包含 Node/ESM 支持与 FSRS 实现。 | 已有真实依赖，用于卡片自评后的下次复习；不替代跨科时间预算。此次不为追新而升级到 6.x。 |
| [dguywhoknows/study-planner](https://github.com/dguywhoknows/study-planner)（[MIT](https://github.com/dguywhoknows/study-planner/blob/main/LICENSE)） | 阅读了 [src/core.js](https://github.com/dguywhoknows/study-planner/blob/main/src/core.js)：纯 JavaScript 逐日贪心排期，以期限余量、难度与信心排序，学习单元依序，已完成单元跳过，并报告未排任务。 | 借鉴工作量、容量、漏做重排和科目交错的概念，不复制源码。固定 +2/+6 天复习与人工拼合 readiness 分值不作为本项目的科学结论。该仓库没有证明通用最优排期或真实提分效果。 |
| [ozakinci/exam-planner](https://github.com/ozakinci/exam-planner)（MIT） | README 与单页实现包含每周不同日预算、临近考试加权和考前一天预留。 | 借鉴可编辑每日容量和考前收尾的产品思路；不照搬“前一晚全部留给一科”的硬规则，避免同日多科冲突。 |
| [Super Productivity](https://github.com/super-productivity/super-productivity)（MIT） | 主仓库提供任务、时间块和时间记录能力。 | 用于理解任务清单与 timeboxing 的共存方式，不当作考试优化算法，不引入其完整应用。 |
| [Taskcheck](https://github.com/00sapo/taskcheck)（AGPL-3.0） | README 展示从工作时间、时长估计、日历阻塞和期限生成排期，支持预览及撤销。 | 借鉴“真实可用时间 + 预览 + 冲突可见”的思路；不复制代码、不接入 Taskwarrior 或外部日历。 |
| [Schedule.js](https://github.com/bunkat/schedule)（MIT） | 虽提供资源与依赖排期，README 明确写明不再积极维护、不宜用于生产。 | 排除作为新依赖；不因为是 JavaScript 就优先接入。 |

上述研究只查阅主源与公开代码，没有克隆、复制或打包第三方项目代码。许可证仅记录查阅时仓库标注，后续若引入具体文件仍应核对该文件及固定版本的许可。

## 算法建议

### 1. 输入先能表达真实约束

- 全局：准备开始日期、目标（及格 / 兼顾 / 高分）、每日默认学习分钟、每周不同预算、日期例外（0 分钟可休息）、专注块与休息长度。
- 时间线：每天可用时段，支持多段，例如 09:00–11:30、19:00–21:00；合并重叠窗口后计算容量。每日学习预算不超过时段可容纳学习量。
- 课程：考试日期、可选考试具体时间、难度、自评掌握、目标分数、预计还需复习分钟。未设置时间的考试当日默认不安排该科新任务，避免编造考试时刻。
- 可选工作量：章节或主题，类型（概念 / 演练 / 回忆 / 模考），可编辑估时。没有真实大纲时显示通用复习任务，不编造章节或题目。

只有日期、难度和分数，无法判断时间是否够用。至少需要可编辑的工作量估计，并明确区分用户估计与系统初始建议。初始建议不冒充从 PDF 页数精确推得的学习时长。

### 2. 先保障容量与截止日

统一使用本地日历日期进行天数计算，不能让 UTC 转换把日期移动一天。先保留已完成任务快照，扣除当天已完成分钟，再规划剩余容量。已完成记录不可因目标修改、重排或任务删除而消失。

计算每个考试截止日前的剩余需求与累计有效容量，输出最早出现缺口的截止日。只比较最后一科考试前的总分钟，会掩盖明天的考试来不及。多科共享同一批时间，不能各自假定拥有所有可用分钟。

分配以截止日保障为骨架：可拆分的学习块优先处理最早到期且已无余量的工作（EDF 思路），剩余可调整容量再结合难度、目标差距、到期卡片和科目交错进行分配。不能仅按“大科总工作量”排序，把临近考试的短任务挤掉。

### 3. 目标改变学习策略，不虚构成功率

- 临时冲刺：减少任务切换，优先核心定义、典型基础题、错题回看，明确时间缺口；不得默认靠熬夜填满。
- 及格优先：更多基础回忆与常见题型，较少进阶拓展。目标仍是分配偏好，不承诺及格。
- 兼顾保过与提分：基础补齐、薄弱点演练和到期回忆平衡。
- 高分：准备时间允许时提高独立演练、模考与复盘比重；时间不足应提示调整工作量或目标。

难度和自评掌握属于用户输入，作答反馈只能提供有限校正。不要把完成勾选直接转换成“考试正确率”或“高绩点概率”。

### 4. 每日与时间线共用任务

先得到一天的任务和分钟，再在窗口中顺序装箱为时段。休息占墙钟时间，但不计学习分钟；跨窗口拆分应有共同任务 ID，避免每段都被重复算完成。切换显示模式不生成另一套任务，不丢失完成状态。

当天未完成任务重排时，只移动未来可变部分；已完成项固定保留。发生日期推进、时间预算变化、考试日期修改、目标变化或任务完成时重新计算。显示“为什么调整”，避免安静地把已发布安排全部洗牌。

### 5. 明确算法可保证什么

应该验证：未完成的新任务在准备开始日之后、考试之前、日预算以内；时间线不重叠、不越过可用窗口；未完成工作不会因跨天自动被当成完成；重算确定可重复；完成快照不会被改写。

当前建议为启发式滚动排期，可解释且易本地部署；不保证组合优化全局最优，更不保证学习收益最优。应通过确定性场景、边界条件和性质测试验证约束，再通过真实使用反馈校准估时和偏好。未来需要精确求解时，可保留相同输入输出契约替换 OR-Tools 或 Timefold 后端。

## 建议接口契约（设计建议，非已部署声明）

```text
PlannerSettings
  startDate, goal, mode: daily|timeline
  dailyMinutes, weekMinutes[7], dateOverrides
  windows[{start,end}], focusMinutes, breakMinutes

CoursePlanning
  courseId, examDate, difficulty:1..5, confidence:0..100
  target, estimatedMinutes, preparationStart?

PlannerResponse
  generatedAt, algorithm, startDate, endDate
  days[{date,budget,allocated,tasks,segments}]
  courses[{courseId,requested,scheduled,shortfall,examDate}]
  warnings[{code,date,courseId?,minutes?,message}]

Task
  id, courseId, kind, title, minutes, reason, completed
Segment
  taskId?, type:study|break, start,end,minutes
```

写入课程设置与规划偏好时应原子校验，拒绝无效日期、负预算、倒置窗口和未授权未来完成。计划读取不改变 FSRS 日期、不伪造历史完成，也不生成题库。任务完成接口需绑定服务器实际生成/保存的任务，不能让客户端任意提交分钟来污染历史。
