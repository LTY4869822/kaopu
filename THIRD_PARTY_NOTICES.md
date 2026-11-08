# 第三方组件、参考项目与素材说明

核对日期：2026-11-04至11-05。本文记录来源与使用关系，不代表赛事资格已获主办方认可。版本以 `package-lock.json`、Python依赖文件、实际安装环境及本文件更新记录为准。

## 2026-11-08 内置画面采集运行时

- `vendor/ffmpeg/win32-x64/ffmpeg.exe.gz` 是 **FFmpeg 6.1.1 essentials build（gyan.dev）** 的 Windows x64 可执行文件压缩包，来自 ffmpeg-static b6.1.1 镜像分发。压缩包 SHA-256 为 `8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77`；解压后的 `ffmpeg.exe` SHA-256 为 `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`。服务仅在首次画面采集时校验并解压到用户私有 `DATA_DIR/runtime`。
- 该构建配置含 `--enable-gpl --enable-version3`，适用 **GPL v3 及所包含第三方组件的许可**，不是 MIT，也不是团队自研解码器。上游完整 GPLv3 文本和构建说明分别保留在同目录 `LICENSE.txt`、`README.txt`；分发本项目时必须一并保留，不能用本摘要替代。
- 用途仅为本机视频探测、关键帧抽取和JPEG编码。B站公开视频元数据与媒体流由独立Node适配器读取；视觉识别仍由用户配置的第三方模型完成。FFmpeg及其编解码器的专利、商标和课程内容授权不因开源许可而自动取得。
- 当前仅内置Windows x64运行时；其他操作系统需在 `.env` 的 `LESSON_FFMPEG` 指定自行准备的FFmpeg，或显式启用旧版Python可选后端。原有 `scripts/extract-lecture-frames.py` 保留，但不再是默认画面采集路径。

## 2026-11-05 文档阅读新增依赖

- **markdown-it 15.0.3**：MIT，来源为[markdown-it](https://github.com/markdown-it/markdown-it)，用于安全的Markdown结构解析；HTML执行与远程图片未启用。保留包内LICENSE及传递依赖声明。
- **Playwright 1.64.1**：Apache-2.0，来源为[Microsoft Playwright](https://github.com/microsoft/playwright)，从原有测试用途扩展为本机PDF生成运行时。实际下载的Chromium及其第三方组件分别附带各自许可；再分发浏览器二进制时应保留对应声明。
- Word的OOXML/Office Math转换在考谱内独立实现，没有打包Microsoft Office或其MathML转换样式表。基础DOCX生成不依赖Office；本机检测到Office时，另有可选的独立Word实例更新原生目录缓存。缺少Office或更新失败的环境需要在Word中更新目录，不能宣称所有环境已经得到同样的缓存页码。

## 网课能力参考项目

下列项目用于方案和架构研究；未将其源代码、图标、品牌或演示内容复制进考谱运行时代码。独立实现、调用外部服务和复制／修改上游源码是不同关系，后续如有实际复制须在此逐文件补记。

本轮新增的 `server/lessons.mjs`、`src/LessonStudio.tsx`、`src/lesson-types.ts` 和配套样式／测试在考谱中独立实现。可选 BiliNote HTTP 适配器连接用户自行配置的服务；这是接口集成，不是把 BiliNote 的服务、模型或源码改称考谱原创。是否实际调用取决于运行配置，演示时应说明数据来自上传字幕、外部服务还是模型生成。

| 项目 | 核验许可与来源 | 2026-11-04 核验的默认分支 HEAD | 当前关系 |
| --- | --- | --- | --- |
| [JefferyHcool/BiliNote](https://github.com/JefferyHcool/BiliNote) | [MIT，Copyright (c) 2024 Jeffery Huang](https://github.com/JefferyHcool/BiliNote/blob/90940fde4d224d0f69ad99674f4af0a1ea52d3c4/LICENSE) | `90940fde4d224d0f69ad99674f4af0a1ea52d3c4` | 视频链接、字幕优先、截图与来源跳转流程参考；未合并其源码 |
| [wansui976/CoursePilot](https://github.com/wansui976/CoursePilot) | [MIT，Copyright (c) 2026 wansui976](https://github.com/wansui976/CoursePilot/blob/2d2ba11bbfcf217b25b5d26e0b6e9c1528e9805b/LICENSE) | `2d2ba11bbfcf217b25b5d26e0b6e9c1528e9805b` | 网课、课件和复习闭环的产品参考；未合并其源码 |
| [Allen0497/video-to-notes](https://github.com/Allen0497/video-to-notes) | [MIT，Copyright (c) 2025](https://github.com/Allen0497/video-to-notes/blob/3d9b2bdc45cc02fa5e53c2703456f4b7942f4678/LICENSE) | `3d9b2bdc45cc02fa5e53c2703456f4b7942f4678` | 声音与关键画面联合整理的流程参考；未合并其脚本 |
| [JimmyLv/BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) | [GNU GPL v3，LICENSE.txt](https://github.com/JimmyLv/BibiGPT-v1/blob/7d5592a651c6352cd63a9e63273fe22dd509dea9/LICENSE.txt) | `7d5592a651c6352cd63a9e63273fe22dd509dea9` | 竞品与可选 API 方案调研；未复制代码，未把当前商业服务当作完整开源产品 |

MIT 允许依条件使用、修改和分发代码，复制其代码或实质部分时需保留原版权及许可文本。GPL v3 的义务与 MIT 不同；若将来复制、修改并分发 GPL 作品，须按实际组合和分发方式履行对应许可及源代码义务，不能用本表的“参考”字样代替。

第三方代码的许可证不同时授予第三方课程视频、字幕、教材、题库、商标、模型权重或云服务的使用权。使用外部服务时按其实际服务条款记录，不能声称该服务或模型由团队研发。

## 已实际使用的直接运行依赖

2026-11-05新增组卷与模考模块独立实现于`server/exams.mjs`和`src/ExamStudio.tsx`。流程与契约参考[DeepTutor](https://github.com/HKUDS/DeepTutor)、[OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)和[Exam Cram Coach](https://github.com/ZeKaiNie/universal-examprep-skill)；未导入其完整运行时、品牌或题库，未复制其源码模块。具体参考关系与实现边界见`docs/exam-workflow.md`。数学排版复用项目已有KaTeX组件，公式展示不构成数学证明。

下表来自本机已安装包的 `package.json` 许可字段；这是直接依赖清单，不是传递依赖的完整 SBOM。尤其 FSRS 记忆调度实际调用 `ts-fsrs`，不应申报为团队发明的调度算法。

| 依赖 | 已安装版本 | 声明许可 | 主要作用／上游 |
| --- | --- | --- | --- |
| react | 19.3.1 | MIT | [Meta／React](https://github.com/facebook/react)，界面运行时 |
| react-dom | 19.3.1 | MIT | [Meta／React](https://github.com/facebook/react)，DOM 渲染 |
| @radix-ui/react-dialog | 1.3.1 | MIT | [WorkOS／Radix Primitives](https://github.com/radix-ui/primitives)，对话框 |
| @phosphor-icons/react | 2.1.10 | MIT | [Phosphor Icons](https://github.com/phosphor-icons/react)，图标 |
| express | 5.3.0 | MIT | [Express](https://github.com/expressjs/express)，HTTP 服务 |
| multer | 2.5.0 | MIT | [Express/Multer](https://github.com/expressjs/multer)，文件上传 |
| mammoth | 1.13.0 | BSD-2-Clause | [Mammoth](https://github.com/mwilliamson/mammoth.js)，DOCX 解析 |
| pdf-parse | 2.4.5 | Apache-2.0 | [pdf-parse](https://github.com/mehmet-kozan/pdf-parse)，PDF 解析 |
| @napi-rs/canvas | 0.1.80 | MIT | [Canvas](https://github.com/Brooooooklyn/canvas)，笔记图片解码、缩放与PDF页面渲染所用原生画布；二进制及其传递组件按各自随包许可 |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later | [JSZip](https://github.com/Stuk/jszip)，Office 压缩包读取；本项目按可选 MIT 路径使用 |
| fast-xml-parser | 5.12.0 | MIT | [NaturalIntelligence](https://github.com/NaturalIntelligence/fast-xml-parser)，XML 解析 |
| ts-fsrs | 5.4.2 | MIT | [Open Spaced Repetition](https://github.com/open-spaced-repetition/ts-fsrs)，FSRS 记忆调度 |

原包的 `LICENSE`／`NOTICE` 等文件随 npm 包提供。制作可分发源码包、桌面包或已打包前端时，应从最终锁文件重新生成完整依赖清单，并一并保留要求的许可与版权文本；不能只交付这张摘要表。构建工具与传递依赖也需包含在最终交付审计中。

### 2026-11-05 Docling实际接入与DeepTutor设计参考

本机已在 `.venv-docling` 中安装 **Docling 2.146.0**，通过独立实现的 `server/docling.mjs` 和 `scripts/docling-convert.py` 调用官方Python库，不将上游解析或OCR模型称为团队研发。PDF明确使用Docling官方 **PyPdfiumDocumentBackend／pypdfium2 5.8.0**，规避本机Windows中文路径下docling-parse资源读取问题；Word／PowerPoint走其原生解析后端。依赖版本见 `requirements-docling.txt`，实际验证及能力边界见 `docs/docling-integration.md`。

| 实际运行组件 | 本机版本／使用关系 | 上游许可与保留事项 |
| --- | --- | --- |
| Docling、docling-slim、docling-core、docling-ibm-models | 2.146.0、2.146.0、2.106.0、4.0.4；文档结构、版面、表格管线 | Docling代码为[MIT](https://github.com/docling-project/docling/blob/v2.146.0/LICENSE)，各安装包附有各自许可；该MIT声明不覆盖所有模型权重 |
| docling-parse | 7.24.2，随Docling安装；当前PDF入口改用PDFium后端 | 安装包附MIT许可；不声称本次扫描验证使用其原生C++ PDF后端 |
| pypdfium2／PDFium | 5.8.0；PDF读取、渲染及Docling PDF后端 | 绑定代码为[Apache-2.0／BSD-3-Clause](https://github.com/pypdfium2-team/pypdfium2/blob/5.8.0/README.md#licensing)；PDFium及所带第三方库分别适用其许可。二进制再分发须保留wheel内PDFium及`BUILD_LICENSES`等许可，不能只保留Python绑定许可 |
| RapidOCR／ONNX Runtime | 3.10.0／1.20.1；本地CPU OCR | [RapidOCR代码Apache-2.0](https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/LICENSE)；ONNX Runtime为MIT并附`ThirdPartyNotices.txt`；OCR模型版权与工程代码分别归属 |
| PyTorch | 复用本机既有2.12.1，不修改全局安装；本地模型推理 | 安装包声明BSD-3-Clause，并附LICENSE／NOTICE及其第三方声明 |

本机下载或从官方RapidOCR wheel校验复制的模型权重逐项登记如下。**这些权重不是团队训练的模型，不能用Docling源码MIT替代其许可。** 模型安装清单记录版本、文件大小与SHA256；三个RapidOCR ONNX文件已与官方注册表SHA256校验一致。

| 本地模型文件／权重组 | 已核查上游快照与许可 |
| --- | --- |
| Heron布局`model.safetensors` | [docling-layout-heron，8f39ad3](https://huggingface.co/docling-project/docling-layout-heron/blob/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8/README.md)：模型卡声明Apache-2.0 |
| Heron ONNX布局`model.onnx` | [docling-layout-heron-onnx，40bde04](https://huggingface.co/docling-project/docling-layout-heron-onnx/blob/40bde044036bb181c130ddf6c51792187268748f/README.md)：模型卡声明Apache-2.0 |
| TableFormer `accurate`及`fast`权重 | [docling-models，fc0f2d4](https://huggingface.co/docling-project/docling-models/blob/fc0f2d45e2218ea24bce5045f58a389aed16dc23/README.md)：该固定模型卡声明 **CDLA-Permissive-2.0**，与推理代码MIT分别记录；再分发时保留[对应许可](https://cdla.dev/permissive-2-0/) |
| `PP-OCRv6_det_small.onnx`、`PP-OCRv6_rec_small.onnx`、`ch_ppocr_mobile_v2.0_cls_mobile.onnx` | [RapidOCR 3.10.0模型许可与归属声明](https://github.com/RapidAI/RapidOCR/blob/v3.10.0/python/MODEL_LICENSES.md)：这三项属于PaddleOCR来源的模型／格式转换，声明Apache-2.0；上游权重版权归Baidu及／或适用的PaddleOCR权利人，RapidOCR工程代码另有其作者版权。再分发须保留适用许可、归属与转换说明 |

比赛源码包**不包含** `.local/`模型／合成验证文件、`.venv-docling/`解释器及安装包、全局Python包或PDFium二进制；只附接入源码、依赖文件及使用说明。若以后提供离线模型或完整运行时发行包，应另行随包保留上述LICENSE／NOTICE／模型许可文本，不能用当前摘要代替。默认关闭公式富化、图片描述和远程推理，不把OCR成功概括为所有课件或公式识别可靠。

[HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor)本轮**仅借鉴设计并独立实现**：题目／答案／rubric／来源固定契约、证据核对、低置信未评分和人工纠错。研究快照为`f7aed0744c36c5afef16a4261c31ebee1208cac2`，[上游许可Apache-2.0](https://github.com/HKUDS/DeepTutor/blob/f7aed0744c36c5afef16a4261c31ebee1208cac2/LICENSE)；未安装或运行DeepTutor整套Python／Web运行时，未复制其品牌或把其系统改称团队原创。当前的模型讲解、答案匹配、评分和KaTeX排版均不构成通用数学证明或符号等价验证，也不据此声明计算题答案准确率。

### 2026-11-04 网课实操优化新增

- [kangarooking/cangjie-skill](https://github.com/kangarooking/cangjie-skill)（MIT）及 [video-downloader](https://github.com/kangarooking/kangarooking-skills/tree/main/video-downloader) 用于声画证据与时间轴格式研究。支持导入其 Markdown 中间稿，不等于打包或运行该工具。`kangarooking-skills` 根 README 声明原创内容默认 MIT，第三方模块另计；未复制其视频号模块或临时公网上传实现。
- 本地获取和转写适配器 `server/local-video-source.mjs`、`scripts/transcribe-course.py` 为独立实现，实际调用第三方 Python 包：yt-dlp 2026.8.19（Unlicense）、faster-whisper 1.2.1（MIT）、PyAV 17.1.0（BSD-3-Clause）、imageio-ffmpeg 0.6.0（BSD-2-Clause）、huggingface-hub 1.18.0（Apache-2.0）。版本与许可字段核对自已安装包的元数据；FFmpeg 二进制按其具体构建许可，不能只用 Python 包许可代替。
- 模型使用已缓存的 [Systran/faster-whisper-base](https://huggingface.co/Systran/faster-whisper-base)，属于第三方模型，不是团队训练的模型。比赛包不包含模型权重或 Python 安装包；可选本地转写所需的FFmpeg仍由部署方准备。默认画面采集随包附带Windows x64 FFmpeg压缩运行时，其许可见本文“2026-11-08 内置画面采集运行时”。
- 公式排版使用 [KaTeX](https://github.com/KaTeX/KaTeX)（MIT），实际安装版本以锁文件为准。
- 后续声画精读调用用户配置的 [DeepSeek API](https://api-docs.deepseek.com/guides/vision/)，当前实测模型为 deepseek-flash。它是第三方生成与图像理解服务，不是团队训练的模型；只向用户选择的服务发送来源文字和采样图片，不使用临时公网图床。原始转写、采样证据与生成校对分别记录。
- 默认板书采集使用内置FFmpeg与既有 `@napi-rs/canvas`；旧版可选Python后端使用 Pillow、NumPy、PyAV/yt-dlp（以对应安装包许可证为准）。新增采集、配置、校对与概览模块为本项目独立实现。比赛包不含任何 API 密钥、课程媒体、识别图片或模型配置数据。
- 真实课程验证素材来自 B 站公开课程的一个分 P，仅用于本机验证；音频、转写全文和个人数据均未纳入比赛源码包。该实测不证明课程版权归属、全站可解析、转写准确率或提分效果。

## 界面参考与图像

- 2026-11-05 手写笔记接入复用已配置的视觉模型服务，`server/handwriting.mjs`、课程归档和逐页校对流程为项目实现，不将模型识字能力申报为团队训练成果。公开手写微积分样例来自 [UBC教学页面](https://personal.math.ubc.ca/~colesmp/teaching/M110/Pencasts/1_7_Limit_definition_of_derivative.pdf)，仅在本机验证，原PDF、渲染图片与完整识别稿不进入参赛源码包。单样本通过不代表所有手写字、课程或公式准确。

- 2026-11-04 内部视觉升级参考 [ThreeUI](https://threeui.com/) 的 3D Paper、Complete Shelf、Animated Top Dock、Performance Gauges、Skeuomorphic Toggle 与 Rectangle Buttons。公开 Community 仓库为 [MengTo/threeui](https://github.com/MengTo/threeui)，许可和固定版本研究记录见 `docs/research/threeui/source-audit.md`。本轮以 React、CSS、SVG 独立实现适合学习流程的纸张、书页、滑块与真实进度，不分发其 Pro 源码、官网缩略图或预览媒体，也未新增 ThreeUI/Three.js 运行依赖。参考截图仅存研究目录。

- 登录入口的视觉／交互参考 [Good Fella](https://good-fella.com/)。孔子雕塑及对应深度估计素材由图像生成工具制作，记录见 `docs/auth-verification.md`；这不能表述为原站人像或美术作品由团队创作。
- `docs/research/good-fella-com-0c318826/root-8a5edab2/source/` 保存了外站 JavaScript 与原图等研究材料。其权利归原作者，未作为考谱生产素材使用，也不属于团队原创；参赛或公开分发源码时应排除该研究资料目录，除非另有可证明的分发授权。
- 当前代码中的示例课程／题目有演示标识；不得把演示数据写成真实学生试验、学校合作或实际提分效果。

## 后续实际复用登记格式

- 2026-11-05 文档分页实际引入 [Paged.js](https://github.com/pagedjs/pagedjs) 0.4.3（MIT，Copyright 2018 Adam Hyde），用于CSS分页、目录目标页码、页边内容。许可证保存在 `docs/licenses/pagedjs-LICENSE.md`，版本由锁文件固定；页面及讲义版式为项目编写。
- 本轮视觉参考 [Linear 官方设计文章](https://linear.app/now/behind-the-latest-design-refresh)、[tldraw](https://www.tldraw.com/) 与 [mousse-notes](https://typst.app/universe/package/mousse-notes/)。只借鉴布局、交互分区与课程笔记层次，未复制这些产品的运行代码、品牌或模板。证据见 `docs/workspace-design-read.md`。

每次复制或改造上游文件，增加：原项目和固定提交、原文件路径、目标文件路径、保留的许可证、团队修改、相关测试。外部 API 则登记服务商、接口版本、用途及数据流，不冒充 vendored 开源代码。纯理念参考保留来源即可，不虚构源代码改造记录。

## 中文界面字体

Noto Sans SC Variable 通过 @fontsource-variable/noto-sans-sc 自托管，版权 Google Inc.，SIL Open Font License 1.1。分发许可副本位于 public/fonts/NotoSansSC-OFL.txt；字体来自 Fontsource（https://fontsource.org/fonts/noto-sans-sc）。


## Galaxy UI 适配

本次 src/ui/controls.tsx 与 src/ui/galaxy-controls.css 参考并适配了 Uiverse.io Galaxy 的箭头按钮、滑动选择背景、复选框与边框加载器。上游为 https://github.com/uiverse-io/galaxy ，固定提交 adbd2adde0a299a3956ea288fb444ec01891ca41，许可 MIT，Copyright (c) 2023 Uiverse.io。完整许可证随站点分发于 public/licenses/galaxy-MIT.txt。原作者与具体文件、修改关系、原始代码快照见 docs/galaxy-components-upgrade.md 及 docs/design-references/galaxy。没有将整套仓库作为依赖打包。
# 2026-11-06 PDF 阅读补充

前端直接使用 `pdfjs-dist@5.4.296`（Mozilla / contributors，Apache-2.0），包含自托管 worker、canvas 与 TextLayer；文字层定位样式参照同版本官方 viewer 约定。许可文本保留在 `public/licenses/pdfjs-LICENSE.txt`。实现参考 [PDF.js 官方示例](https://mozilla.github.io/pdf.js/examples/)。它负责显示服务端生成的 PDF，不作为本项目原创 PDF 解码器申报。

