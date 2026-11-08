# Docling 本地结构化解析

本项目保留轻量原生解析，增加独立 Python 侧车来读取 PDF、DOCX、PPTX。公式富化、图片描述、远程推理服务均关闭；PDF OCR 使用 CPU＋RapidOCR ONNX 中英模型。原始文件保存、HTTP 断开事件与界面由调用方管理。

## 安装与模型准备

在项目根目录执行。依赖只写入隔离环境，`--system-site-packages` 可复用本机已有 PyTorch；无需更新全局环境。

```powershell
python -m venv --system-site-packages .venv-docling
.\.venv-docling\Scripts\python.exe -m pip install -r requirements-docling.txt
.\.venv-docling\Scripts\python.exe scripts/docling-convert.py --download-models --artifacts-path .local/docling-models
.\.venv-docling\Scripts\python.exe scripts/docling-convert.py --probe --artifacts-path .local/docling-models
```

下载命令使用 Docling 官方下载器和官方模型仓库，只选择版面、表格及 `onnxruntime:ch` OCR，不下载公式／图片描述VLM。RapidOCR 3.10.0的官方PyPI wheel已包含默认ONNX模型时，先与其官方模型注册表SHA256逐项校验，再复制到项目模型目录；不重复下载同一模型。缺失时才使用注册表中的RapidAI官方ModelScope地址，每文件限制连接10秒、读空闲30秒、总时长120秒和64MiB。安装命令默认总时限300秒，可用`--download-timeout 120`等参数缩短（范围30–600秒）。

下载失败可以重新执行，已完成的文件可复用。只有整个准备阶段结束后才生成本项目模型清单，记录版本、大小和安装时SHA256；探针核验清单、版本及各文件大小。下载时禁用隐式账号token及Xet通道，不使用第三方镜像。当前本机已准备22项文件，共732,973,810字节。

Node默认寻找本项目 `.venv-docling/Scripts/python.exe`（非Windows为`bin/python`）和`.local/docling-models`。可用 `DOCLING_PYTHON`、`DOCLING_ARTIFACTS_PATH` 精确覆盖这两个路径。不要把环境文件、模型权重或虚拟环境提交到Git。

请求时强制模型离线，不会自动下载或调用远端AI API。`status()`返回公开的`available`、`ocrReady`、`structuredPdfReady`、`engine`、`version`、`formula:false`和中文说明，不返回解释器／模型路径、环境变量或异常栈。`available=true`表示Docling包可导入；OCR就绪另有独立字段。文件存在不保证所有未知文档都能成功识别。

## Node接口

```js
import { createDocumentParser } from './server/docling.mjs';

const parser = createDocumentParser();
const health = await parser.status();
const result = await parser.parse(multerFile, {
  mode: 'auto', // auto | structured | basic
  signal: abortController.signal,
});
```

`multerFile`使用`buffer`与`originalname`，不接受URL或任意源路径。调用方在连接断开时应中止`AbortController`；不要在正常响应写出完成后误触发取消。

- `basic`始终使用当前原生解析器，不启动Python。
- `auto`先原生解析；文字不足、乱码或PDF文字页覆盖不足时尝试Docling。该规则是启发式，也可能把空白页／图多文少的PDF送入重解析。若已有少量文字但Docling未安装，保留原生结果并给出明确提示；扫描文件无文字且侧车不可用则报错。
- `structured`明确调用Docling；仅支持PDF／DOCX／PPTX。缺包／缺模型报503，失败报422，超时报504；不把原生结果包装成结构化成功。

每个parser实例只运行一个Python子进程，最多8个等待任务。探针也使用同一队列并缓存30秒。转换默认超时180秒，可通过工厂选项`timeoutMs`调整（最多600秒）。生产进程使用`shell:false`，Windows隐藏窗口；取消和超时直接终止该自有进程。Windows venv的python.exe本身是重定向启动器，因此运行器读取该venv的`pyvenv.cfg`，使用相同基础解释器、只为子进程设置该隔离环境的`PYTHONPATH`，直接持有实际worker，避免只终止启动器后遗留转换进程。适配器使用原生Office解析与ONNX线程，不启动外部OCR命令。

PDF使用Docling官方`PyPdfiumDocumentBackend`：本机中文项目路径下，docling-parse 7.24.2原生C++后端不能打开已存在的glyph资源；PDFium后端可用，继续执行相同的OCR／版面／表格管线，并保留页码和坐标。`parser.backend:'pypdfium2'`明确记录这一选择。

每次转换创建独立系统临时目录，源文件只用固定`input.pdf/docx/pptx`名称，成功、失败或取消后均清理。20MB输入、PDF／PPTX最多250页／张、Office最多2500个ZIP条目及解压60MB等边界，在进入侧车前检查；Python再次校验实际解压量。正文上限100万字符，最多1万个结构块、5000个片段，进程stdout上限8MiB；stderr只排空，不返回客户端。第三方异常会转换为固定公开错误。

## 输出与来源定位

保留原接口的`type`、`chunks`、`locationKind`、`warning`，新增：

```js
{
  parser: { engine: 'docling', version: '2.146.0', backend: 'pypdfium2', ocr: true, formula: false },
  structure: {
    blocks: [{ id, text, label, page, bbox, sourceRef, charspan }],
    pages: [{ page, width, height }],
    tables: [{ id, rows, columns }]
  }
}
```

`chunks`另携带真实`blockId`、`sourceRef`、`bbox`和`charspan`（有值时）。`bbox`为`{l,t,r,b,coordOrigin:'TOPLEFT'|'BOTTOMLEFT'}`；坐标单位随原格式变化，PPTX通常是EMU，必须结合对应`pages.width/height`缩放，不能当作像素。`sourceRef`是Docling内部如`#/texts/0`的引用；块ID还含源文件SHA前缀，防止不同资料的指针重名。重新解析或更换上游版本后应使用新解析结果整体替换，不能把旧引用强行映射到新块。

表格正文已包含在结构块中，`tables`只提供行列摘要，不重复发送单元格HTML或外部资源。公式`formula:false`表示未启用公式识别模型，不承诺原生公式或公式图片都能恢复。PDF的`ocr:true`表示OCR管线已启用，并非逐块OCR来源声明。

**DOCX没有可靠物理分页。** 它返回`locationKind:'section'`；块携带`section`而没有伪造`page`，`chunks.page`只为兼容旧接口保留分节编号，`chunks.section`有相同数值。前端必须按“节”显示。PDF页号、PPTX幻灯片号来自Docling provenance；无物理provenance的块不会伪造页号成为可定位片段。

基础解析返回`parser.engine:'native'`及简单块结构；它没有版面坐标。OCR与文档结构也不等于科目分类，这个模块不擅自调整课程归属。

## 验证记录

2026-11-04至11-05，Windows、Python3.12.8、Docling2.146.0、RapidOCR3.10.0、ONNX Runtime1.20.1，隔离环境复用本机PyTorch2.12.1。所有验证源均由程序新建，未读取用户资料目录或账号。

- 已真实解析合成DOCX：4个块、2×2表格，引用为分节且无物理页码。首次转换约27.7秒（含Python及Docling冷启动）。
- 已真实解析合成2页PPTX：5个块、2×2表格，返回真实幻灯片号、bbox、charspan、sourceRef；首次转换约17.8秒。上述耗时是该次观察，不是性能保证。
- 已通过真实`createDocumentParser().parse(file,{mode:'auto'})`解析一页仅含图片的中英扫描PDF：3个块，均有第1页、bbox、charspan及sourceRef；页尺寸672×864点。实际识别出`Linear Algebra Review Matrix multiplication AB Inner dimensions must agree.`、`线性代数期末复习`、`矩阵乘法需要检查维度。`，英文和中文内容断言均通过。总45.3秒包含自动模式的基础解析尝试、探针和冷启动，并非单纯模型推理时间。
- 验证后真实`status()`为`available:true / ocrReady:true / structuredPdfReady:true / formula:false`。合成输入保存在`.local/docling-smoke/scan.pdf`，实际完整结果为`.local/docling-smoke/ocr-result.json`；它们只作本地验证，不是用户资料。
- `tests/docling.test.mjs`覆盖模式选择、扫描升级、结构化失败、DOCX分节、真实临时文件写入与清理、队列／取消、大小边界和错误脱敏；还包含实际子进程的超时／输出上限／中断测试。用`node --test tests/docling.test.mjs`运行。

源码遵循Docling MIT许可；下载的具体OCR、版面和表格模型需分别保留其仓库许可证。本模块不把源码许可概括成所有模型／依赖都可无条件分发。
