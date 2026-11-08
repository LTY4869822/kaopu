# Docling 与 DeepTutor 局部接入

用户授权：将前两个推荐项目借鉴到现平台。沿用 React/Vite+Node、现有课程和复习规划。Docling 是实际本地解析依赖；DeepTutor 借鉴题目契约、证据校验与判分流程，独立实现兼容服务，不嵌入其整套应用。

## 文件分工
- 文档：server/docling.mjs、scripts/docling-convert.py、requirements-docling.txt、tests/docling.test.mjs，隔离.venv-docling与.local/docling-models。
- 练习后端：server/assessment.mjs、tests/assessment.test.mjs。
- 练习前端：src/PracticeStudio.tsx、src/practice-studio.css、src/assessment-types.ts。
- root：server/index.mjs、src/App.tsx、src/types.ts、BatchImport读取方式、原文件存取/来源导航、集成测试/说明。

## 文档契约
createDocumentParser(options)返回parse(file,{mode:'auto'|'structured'|'basic',signal})与status()。
兼容type/chunks/locationKind/warning，新增parser与structure。chunk可带blockId/bbox/sourceRef/section；PDF页与PPT张为真实编号，DOCX为段/节。结构保留blocks/pages/tables。
auto仅在原生读取不足时升级；structured明确调用Docling，失败报错；basic只走轻量解析。上传原文件另存于受API鉴权保护的data/documents，客户端只获得hasOriginal，不暴露存储路径。新文件可通过/api/documents/:id/original查看/下载。

## 有依据练习契约
state.assessments={version:1,questions:私有契约[],attempts:[]}，从/api/state隐藏，授权备份保留。
- GET /api/assessment?courseId=... -> {configured,questions,attempts}
- POST /api/assessment/generate {courseId,count:1..6默认3,types:['single-choice','short-answer'],focus?} -> {questions,warning?}
- POST /api/assessment/attempts {questionId,answer:string,helpUsed?:boolean} -> {attemptId,status,confidence,feedback,expectedAnswer?,explanation,steps,sources,counted,correct?}

PublicQuestion={id,courseId,type,topic,prompt,options:[{id:'A',text}],difficulty,sources,createdAt,version?,generationMode?}。来源={documentId,documentName,chunkId,page,locationKind:'page'|'section',text,bbox?,blockId?}。公共题不返回答案键、rubric或参考答案。提交结果才显示反馈与参考答案。
PublicAttempt={id,attemptId,questionId,courseId,answer,status,confidence,feedback,expectedAnswer,explanation,steps,sources,counted,correct?,helpUsed,createdAt}。
status为correct/partial/incorrect/ungraded；短答始终不计掌握度。模型低置信/错误/结构不合法时ungraded，不标错、不生成假分数。MCQ只首次独立作答可计；打开引文/提示后helpUsed:true；反复练同题不累计掌握度。来源/题目改动、删除或跨课程时拒绝旧题提交。

生成先有蓝图，再基于有限真实chunk出题；格式、答案键、来源引用、原句和重复校验均过才整体入库。有限修复仍失败不保存残缺题。原文回忆继续用现有/questions/generate和/attempts，不伪称理解/计算题。

## PracticeStudio约定
Props={state:State,courseId:string,onCourseChange:(id:string)=>void,onRefresh:()=>Promise<unknown>,onNotify:(text:string)=>void,onOpenSource:(source:AssessmentSource)=>void}。
内部拥有课程选择、原文回忆/理解应用切换、数量/题型/可选重点、生成/作答/反馈/错题/下一题/记忆卡。保留practice-panel/option/question-prompt/answer-panel等关键类。右侧原有ask-panel由App保留。直接复用独立ModelSettings组件，未配置文字模型时提供配置入口，原文回忆可独立使用。
所有请求有课程/材料版本或卸载隔离、双击保护；短答有长度限制。来源展开/查看后标记用过帮助；“待核对”与错误分开。手机正文≥14px，按钮≥44px，沿用纸面/橙色界面。

## 验证边界
默认应用测试实例保持轻量native解析；可注入documentParser测试OCR/失败/超时。新题模型通过mock真实HTTP契约测试，绝不把本机私密资料发往测试模型。合成PPTX/DOCX/扫描PDF由本机真实Docling验证；真实模型出题需已配置的文字模型，源码校验不等于数学答案证明。
