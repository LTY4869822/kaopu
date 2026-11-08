# 拾分 · AI 期末复习平台

## 作品简介

拾分是一款面向大学生的 AI 期末复习平台，将课件、PDF、B 站网课和笔记整理为可追溯的课程知识库，串联复习规划、练习答疑、模拟考试与间隔记忆，解决资料分散、重点难抓、复习无计划和错题难复盘的问题。作品运用大语言模型完成资料归科、考点提炼、讲义生成、上下文问答与智能组卷，结合视觉模型识别板书和试卷内容，并通过 FSRS 算法个性化安排复习，让学习资料转化为可执行、可反馈的提分路径。

**开发交接先读 [HANDOVER.md](HANDOVER.md)**，再看 [架构与算法](docs/handover/ARCHITECTURE.md)、[验证记录](docs/handover/VERIFICATION.md)、[已知边界](docs/handover/KNOWN_ISSUES.md)。这些文件描述 2026-11-06 的交付现状；较早文档用于了解历史。

## 启动

使用 Node.js 24 LTS，在项目目录执行：

```powershell
npm ci
npm run setup:pdf
npm run build
npm start
```

打开 http://127.0.0.1:3001。首次创建自己的本机账户，再到「设置 → API 与模型」配置文字、视觉连接。交接包没有预设账号或密钥。

开发时运行 `npm run dev`，前端地址以 Vite 终端输出为准，API 默认 3001。Vite 的代理目前固定指向 3001；不要并行运行两个实例写同一个数据目录。生产进程修改源码后需要重新构建、重启。

## 学习流程

1. 资料导入：添加 PDF、DOCX、PPTX、TXT、Markdown 或照片，点击开始后归入对应课程；不确定的归属由用户确认。
2. 我的课程：多选资料整理笔记、提问、修订，产物保留出处；PDF.js 显示真实 PDF，可下载 PDF 或可编辑 Word。
3. 复习规划：设置各科考试、难度、剩余工作量与可用时间，选择时间线或按天完成。
4. 网课笔记：链接/字幕/原文，按知识点和例题阅读、核对画面、上下文追问，再归档课程。
5. 练习答疑：自定义一组题，完成整组后统一讲评；切题和刷新保留已保存作答。
6. 期末模考：自定义组卷或分析真题结构并确认模板，限时作答、交卷、订正和针对性复练。

回忆卡使用 FSRS 安排间隔复习。无模型时仍能做基础解析、规则归科、原文回忆和规划；生成式功能需要有效模型连接。AI 内容和建议分需要结合出处核对。

## 验证与打包

```powershell
npm test
npm run build
npm run test:recovery
npm run test:documents:ui
npm run package:handover
node scripts/verify-handover.mjs
```

本次单元/API 377 项通过，版本恢复 UI 3 项、文档工作台 UI 7 项通过；还从候选压缩包解压完成干净安装、构建、全部测试和正式认证启动检查。详细范围与限制见 [机器可读结果](docs/handover/verification-results.json)。

## 运行数据与可选依赖

学习状态、账户、模型连接和原件默认存于私有 `data/`。网页 JSON 导出不等于包含原始文件和账号的完整备份；迁移与找回密码见交接说明。源码包保留 `.env.example`，实际账号、密钥与学习数据保留在原电脑。

Python/Docling/语音模型属于可选增强，未随源码包复制。Windows x64 的默认网课画面采集已内置压缩 FFmpeg，无需安装 Python；也支持在板书页面上传本地视频或截图。先跑通 Node 主流程，再按 [Docling 接入](docs/docling-integration.md) 和 [网课流程](docs/lecture-workflow.md) 安装可选增强。

第三方代码与素材归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。交接包包含锁文件、当前构建、依赖许可与 SHA-256 文件清单；它是工作区快照，不代替 Git 历史或正式上线发布。
