# 理工科复习增强建议

调研日期：2026-11-05。用户确定首批课程为高数、线代、概率论、大学物理。

这是调研与实施建议，下面的计算组件尚未接入考谱网页。现有资料导入、网课精读、练习生成和来源核对继续保留；当前开放计算与证明题仍需要人工核对。

## 建议的学习流程

选本课题型 → 学生先写一步 → 在支持范围内检查 → 给下一条提示 → 独立完成一道变式题。

默认仅呈现题目、当前步骤及“检查这一步／给个提示／换一道”。完整解答按需展开。先建立有限题型模板，再扩大覆盖；不能把任意自然语言证明都标成可自动验证。

| 课程 | 首批题型建议 | 反馈内容 |
| --- | --- | --- |
| 高等数学 | 复合函数求导、基础极限、换元与分部积分 | 链式法则漏项、符号错误、定义域与积分常数 |
| 线性代数 | 初等行变换、线性方程组、秩 | 每次行变换是否合法、自由变量、唯一解与无穷解的区分 |
| 概率论 | 条件概率、常见分布、期望与方差 | 已知条件与事件、分布参数、符号答案与数值结果 |
| 大学物理 | 受力与运动、能量与动量、基础带电粒子题 | 适用条件、公式与代入、单位和量纲；建模正确性另行判断 |

## 核实过的开源组件

| 项目 | 用途及接入建议 | 许可与边界 |
| --- | --- | --- |
| [MathLive](https://github.com/arnog/mathlive) | React 包装数学输入框，学生可输入分式、积分、矩阵，输出结构化表达式 | [MIT](https://github.com/arnog/mathlive/blob/master/LICENSE.txt)；是输入组件，不是自动解题器 |
| [SymPy](https://github.com/sympy/sympy) | 独立 Python 计算进程承担极限、导数、积分、矩阵和符号概率，Node 仅提交受控任务 | [BSD-3-Clause](https://github.com/sympy/sympy/blob/master/LICENSE)；受变量假设、定义域、解析歧义和算法能力限制 |
| [SymPy Gamma](https://github.com/sympy/sympy_gamma) | 参考求导与积分步骤展示，适配当前 SymPy 规则树 | [BSD-3-Clause](https://github.com/sympy/sympy_gamma/blob/master/LICENSE)；旧整站依赖需升级验证。现代 [integral_steps](https://docs.sympy.org/latest/modules/integrals/integrals.html#sympy.integrals.manualintegrate.integral_steps) 可返回积分步骤树，不覆盖任意题 |
| [JSXGraph](https://github.com/jsxgraph/jsxgraph) | 切线、面积、向量、概率分布等可拖动图，与题目变量绑定 | MIT 或 LGPL 双许可，可选 [MIT](https://github.com/jsxgraph/jsxgraph/blob/main/LICENSE.MIT)；教学模板需要本项目实现 |
| [SciPy](https://github.com/scipy/scipy) | [scipy.stats](https://docs.scipy.org/doc/scipy/reference/stats.html) 计算分布、CDF、分位数及抽样，与符号概率互补 | [BSD-3-Clause](https://github.com/scipy/scipy/blob/main/LICENSE.txt)；数值近似和模拟不等于数学证明，正态分布 scale 指标准差 |
| [Pint](https://github.com/hgrecco/pint) | 物理量计算、单位换算和量纲兼容检查 | [BSD-3-Clause](https://github.com/hgrecco/pint/blob/master/LICENSE)；量纲正确不证明所用定律或系数正确 |

[STACK](https://github.com/maths/moodle-qtype_stack) 值得作为数学题反馈设计参考：表达式答案测试、常见错误分支和随机参数题。官方有独立 API，并不限于直接嵌入 Moodle；但 PHP/Maxima 部署和题目编写成本需评估。其源码为 GPL-3.0，文档和示例题分别为 CC BY-SA 4.0，见 [项目声明](https://github.com/maths/moodle-qtype_stack/blob/master/Readme.md)。不把示例题或现成题库自动视为本团队原创。

[Matter.js](https://github.com/liabru/matter-js)（MIT）可在后续做力学运动演示。它是二维刚体数值引擎，不作为考试标准答案求解器，也不能覆盖完整电磁和热学。

## 第一阶段建议

先交付 MathLive + SymPy 的逐步练习，再为概率接入 SciPy、为物理接入 Pint，最后加与题目对应的 JSXGraph 交互。首先以每科几个经过核验的题型建立流程，不承诺全科万能自动判分。

AI 负责从资料定位题型、给中文解释和生成候选变式；受控计算负责核对能验证的结果。仅允许受控表达式结构、函数与计算任务，限制进程时间和资源，不把用户表达式直接当 Python 代码执行。

验证状态至少区分：给定条件下已验证、找到不成立的反例、无法判定。注意等式变形的条件、除零、增根、分段函数、不定积分常数及单位。数值抽样通过不能冒充恒等证明。

## 本机可行性小试

未安装新依赖，使用本机已有 SymPy/SciPy 单独运行：

- 复合函数求导得到 `2*x*cos(x**2)`，与目标表达式差值化简为0。
- 增广矩阵 `[[1,1,2],[2,2,4]]` 得到一自由变量的解集，未误判为唯一解。
- 两枚公平六面骰条件概率 `P(A+B>=10 | A=6)` 得到 `1/2`。
- 标准正态分布 `P(-1<=Z<=1)` 数值为约 `0.68268949`。
- 正质量、重力加速度和高度且忽略阻力的能量方程，正速度解为 `sqrt(2*g*h)`。

这些结果只证明局部计算方案可行，不代表平台已接入、手写步骤能任意识别、教学效果已验证或全部题型均能自动评分。
