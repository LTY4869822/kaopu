# 考谱 · 大学生 AI 期末复习平台

考谱帮你用自己的课件复习。把一章课件和课堂笔记归到同一门课，可以整理出带出处的讲义，围绕考点练习，再按考试日期把薄弱章节排进复习计划。

[直接体验考谱工作台](https://lty4869822.github.io/kaopu/?demo=1) · [产品首页](https://lty4869822.github.io/kaopu/) · [开发交接说明](HANDOVER.md)

## 选择使用方式

| 方式 | 适合的场景 | 资料保存位置 |
| --- | --- | --- |
| GitHub Pages | 免登录，用示例课件体验资料归科、笔记整理、练习批改与网课精读 | 演示状态随页面刷新重置 |
| 本机运行 | 在自己的电脑上注册账户、导入资料并持续复习 | 本机的 `data/` 或指定目录 |
| GitHub Codespaces | 在浏览器中运行包含前后端的个人实例 | 当前 Codespace 工作区，删除实例前请备份 |
| Docker Compose | 在自己的服务器上通过域名和 HTTPS 长期使用 | 挂载到容器 `/data` 的数据卷 |

## 本机安装

安装 Git、Node.js 24 和随 Node 安装的 npm，在终端运行以下命令。

```sh
git clone https://github.com/LTY4869822/kaopu.git
cd kaopu
npm ci
npm run setup:pdf
npm run build
npm start
```

打开 <http://127.0.0.1:3001>，选择「创建账户」，设置昵称、邮箱和密码。邮箱用于登录。每个账户有独立的课程、原件、练习记录和模型配置。首次体验可以先使用示例课程。

`setup:pdf` 下载生成 PDF 需要的 Chromium。精简 Linux 系统可用 `npx playwright install --with-deps chromium` 一并安装系统依赖。

## 从一份资料开始复习

1. **导入课件。** 在「资料导入」选择 PDF、DOCX、PPTX、TXT、Markdown 或图片，分析后核对归属课程。第一次可以用一份有文字层的 PDF，对照提取出的原文。
2. **整理笔记。** 在「我的课程」勾选同一门课的资料，提出具体要求，例如“按定义、适用条件和例题整理本章”。阅读时可以核对出处，按需下载 PDF 或可编辑 Word。
3. **读网课。** 导入支持的 B 站链接、字幕或原文，按知识点阅读讲义，回到对应片段核对板书。可用内容取决于视频权限、字幕和本机组件。
4. **安排时间。** 在「复习规划」填写考试日期、剩余工作量和每周空闲时间，查看逐日任务和时间缺口。
5. **检验掌握程度。** 「练习答疑」支持原文回忆和理解应用，整组提交后查看反馈。「期末模考」支持选择范围、题型和分值，或确认真题结构后组卷。回忆卡使用 FSRS 安排下次复习。

## 模型与可选组件

基础文本解析、规则归科、原文回忆与排期可以先在本机体验。要生成讲义、智能组卷或问答，打开「设置 → API 与模型」，填写兼容 `/chat/completions` 的服务地址、模型名和密钥，先测试连接，再保存。地址应包含提供方要求的路径前缀，例如 `/v1`。手写内容和板书识别需要支持图片输入的视觉模型。

使用模型时，相关资料片段或图像会发送给所配置的服务。密钥保存在对应账户的运行目录中，备份时需要一并保护。

| 组件 | 用途 |
| --- | --- |
| Docling | 扫描件与复杂版式的增强解析。安装及模型缓存见 [Docling 接入说明](docs/docling-integration.md) |
| 本地语音转写 | 无公开字幕时，可安装 Python、转写依赖并配置本地模型，见 [网课处理流程](docs/lecture-workflow.md) |
| FFmpeg | 从视频抽取画面。Windows x64 和 Docker 镜像附带 FFmpeg，其他环境可安装后用 `LESSON_FFMPEG` 指定路径 |

### 运行配置

将根目录的 `.env.example` 复制为 `.env`，按需填写后重启服务。个人模型连接也可以直接通过设置页配置。[配置示例](.env.example)

| 变量 | 用途 |
| --- | --- |
| `HOST`、`PORT` | 本机默认监听 `127.0.0.1:3001` |
| `DATA_DIR` | 运行数据根目录，默认使用项目内的 `data/` |
| `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY` | 服务端文字模型默认连接 |
| `VISION_BASE_URL`、`VISION_MODEL`、`VISION_API_KEY` | 独立视觉模型默认连接 |
| `TRUST_PROXY`、`AUTH_COOKIE_SECURE` | 单层受信代理与 HTTPS 会话 Cookie，Compose 已配置 |
| `DOMAIN` | Docker Compose 传给 Caddy 的域名 |

Compose 通过 `compose.yaml` 的 `environment` 显式传递容器变量。使用容器级模型默认值时，在该处添加对应变量映射。

## 在 GitHub 上运行

**公开演示。** `main` 更新后，GitHub Actions 安装锁定依赖，运行 `npm run build:pages`，将 `dist-pages/` 发布到 Pages。访客可以操作内置示例。保存学习资料、账户登录和模型调用由完整版的 Express 服务提供。[发布工作流](.github/workflows/pages.yml) · [GitHub Pages 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

**个人完整版。** 登录 GitHub，通过 [Codespaces 开发环境入口](https://codespaces.new/LTY4869822/kaopu) 创建工作区，等待容器安装依赖、下载 Chromium 并构建前端。在终端运行 `npm start`，然后在 **Ports** 面板打开 **3001** 的转发地址，创建自己的考谱账户。工作区停止后可重新启动，再执行 `npm start`。计算与存储使用当前 GitHub 账户的 Codespaces 配额。[容器配置](.devcontainer/devcontainer.json) · [端口转发文档](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)

## 在自己的服务器上部署

准备装有 Docker 和 Compose 插件的服务器，将域名解析到该服务器并允许访问 TCP 80、443。克隆仓库后，在根目录的 `.env` 写入自己的域名，例如 `DOMAIN=study.example.com`，然后运行以下命令。

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app caddy
```

使用 HTTPS 打开配置的域名。Caddy 申请证书并反向代理到应用的 3001 端口，应用以单实例写入数据卷。升级前先备份，再执行 `git pull --ff-only` 和 `docker compose up -d --build`。已有部署请沿用原 Compose 项目名及数据卷，以便继续访问原资料。

## 数据、备份与恢复

- `DATA_DIR/auth.json` 保存账户索引。各账户的课程状态、原件、知识库和模型设置位于 `DATA_DIR/users/<账户标识>/`。
- 网页可以导出学习状态 JSON。整机迁移时，先停止写入，再备份完整的 `DATA_DIR` 或数据卷。恢复时将备份解压到空目录、保留访问权限，用同版本程序指向该目录启动，登录抽查课程和原件后再切换。
- Docker 管理员可运行 `sh scripts/backup-cloud.sh`。脚本暂停应用，将数据卷归档至 `backups/` 并生成 SHA-256 校验文件，然后重启服务。归档含私有资料和模型配置，请保管在受控位置。
- 忘记密码时，管理者在实例所在机器、相同数据目录下运行 `npm run recover -- <注册邮箱>`，按提示在 15 分钟内使用一次性恢复链接。本机默认地址为 3001；远程服务器可通过本地端口隧道访问。服务重启后需要重新登录。

## 开发与验证

```sh
npm run dev                # 同时启动 Vite 和 Express
npm test                   # 单元与 API 回归
npm run build              # TypeScript 检查并构建完整版
npm run build:pages        # 构建 GitHub Pages 演示
npm run test:documents:ui  # 文档工作台浏览器测试
npm run test:recovery      # 浏览器资源更新恢复测试
```

开发页地址以 Vite 终端输出为准，通常为 <http://localhost:5173>；其 `/api` 代理指向 `127.0.0.1:3001`。修改 API 端口时请同步更新 Vite 配置。运行 UI 测试前先安装 Chromium 并构建完整版。测试使用临时数据和模型替身。[Vite 配置](vite.config.ts)

| 路径 | 内容 |
| --- | --- |
| `src/` | React、TypeScript 界面，含资料工作台、规划、练习、模考与 PDF.js 阅读器 |
| `server/` | Express API、账户、解析、模型连接、检索、排期和文档导出 |
| `public/`、`vendor/` | 随应用分发的静态资源、许可文件和运行组件 |
| `tests/`、`scripts/` | 回归测试、浏览器验证、备份、恢复及交接打包工具 |
| `demo/`、`.github/workflows/` | 公开演示入口和 Pages 发布流程 |

**常见问题**

- **首页只显示服务已启动。** 在项目根目录执行 `npm run build`，重启 `npm start` 并刷新。
- **开发页无法连接 API。** 检查 Express 终端输出、3001 端口占用和 Vite 代理配置。
- **能读资料，生成笔记时失败。** 到设置页测试文字模型。若只有图片识别失败，再检查视觉模型的图像输入能力。
- **PDF 预览或导出失败。** 执行 `npm run setup:pdf`。Linux 还需安装 Chromium 系统依赖及中文字体。
- **升级后看不到原课程。** 核对登录邮箱、进程使用的 `DATA_DIR` 及 Compose 实际挂载的数据卷。

更多实现细节见 [架构与算法](docs/handover/ARCHITECTURE.md)、[课程工作台 API](docs/course-studio-api.md) 和 [模考 API](docs/exam-api.md)。第三方代码、字体与素材来源见 [第三方声明](THIRD_PARTY_NOTICES.md) 及 [依赖许可](DEPENDENCY_LICENSES/)。
