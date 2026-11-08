# ThreeUI 视觉交互升级验证

日期：2026-11-04。当前开发地址 http://localhost:5174/。

## 交付
- 研究与映射：`docs/research/threeui/source-audit.md`、`upgrade-plan.md`、`components/*.spec.md`。
- 主界面：App.tsx、CommandPalette.tsx、ui-system.css、ui/motion.ts。
- 页面：BatchImport、CourseCatalog、CourseWorkspace、StudyPlanner及对应样式。
- 参考关系已登记 THIRD_PARTY_NOTICES.md。未新增运行依赖，未复制官网预览媒体。

## 验证结果
- TypeScript及Vite生产构建通过，日志 `test-results/threeui/build.log`。
- `node scripts/threeui-smoke.mjs`：31项布局记录，覆盖1440、1024、768、390、320宽度的首页、课程、规划、练习、记忆与精读；无横向溢出和页面错误。快捷搜索验证焦点、键盘选择、真实课程和原文跳转、无结果、Esc恢复焦点。所有API重定向临时后端。
- `npm run test:batch`：11组流程、4项布局。选择阶段上传/建课均为0，显式开始、追加、清空、失败重试、未知科目、归档、重复检测与跨页面同步通过。
- `npm run test:workspace`：9组流程、13项布局。课程切换、原文/摘录、资料移动/删除及迟到问答隔离通过。补充核验考试排序、空日期最后、16:9与减少动态/粗指针回退。
- `npm run test:planner`：15组流程、24项布局，使用临时数据。单日调整、休息、保存、模式持久化、完成/撤销、缺口与考试日约束通过；手机首屏有至少44×44的真实学习入口，点开后课程归属匹配。聚合提醒的旧前置断言已根据新层级改为“在助手内、安排后且仍可操作”，并增加当日冲突提醒必须留在安排内的断言。
- 规划API/单元17项、额外仪表值/空任务/定向展开核验通过。新仪表不使用演示计数。
- `node scripts/auth-ui-smoke.mjs`：全部API mock，登录状态竞态、401过期、重试与退出回归通过，无页面错误。

## 当前用户浏览器
在用户原有已登录标签里验证首页、课程目录、快捷搜索进入高等数学工作台和规划页。最后返回首页，账号保持登录；1283×668下文件选择按钮底部约535px，首屏可见。未重设账号，也未上传、删除或修改用户课程资料/规划条件。

实际首页截图 `docs/screenshots/threeui-live-home.jpg`；隔离桌面/手机截图为 `docs/screenshots/threeui-*.png`。完整页面截图可能触发基于高度的响应布局，首屏可见性结论以真实视口的元素坐标为准。
