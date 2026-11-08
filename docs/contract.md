# Shared implementation contract
Backend Node ES modules, front React TS. API under /api. JSON responses; failures {error:string}. Server port 3001, Vite 5173 proxy /api.

GET /api/state -> {courses,documents,cards,questions,attempts,settings,completedTasks,focusMinutes,providerConfigured}
Course: {id,name,examDate:'YYYY-MM-DD'|'',target:number,mastery:number,color:string,icon:string,chapters:number,description:string,isDemo?:boolean}. Empty examDate means not scheduled; never invent a date. POST /courses accepts omitted/null/empty date; PATCH accepts null/empty to clear; nonempty dates remain strictly validated.
Document: {id,courseId,name,type,size,createdAt,status:'ready',chunks:[{id,text,page:number}],summary:string[],isDemo?:boolean}
Card: {id,courseId,front,back,due:string,source:string,fsrs?:object}
Question: {id,courseId,topic,prompt,options:string[],answer:number,explanation:string,steps:string[],difficulty:string,source:string}
Settings: {dailyMinutes:number,goal:'balanced'|'pass'|'high',name:string}
POST /api/courses {name,examDate,target,color?} -> course
PATCH /api/courses/:id {examDate,target,name} -> course
DELETE /api/courses/:id -> {ok:true} cascading
POST /api/documents multipart 'file', courseId -> document
POST /api/documents/auto multipart 'file' (no courseId) -> {document,course:Course|null,createdCourse:boolean,duplicate:boolean,classification:Classification}. Creates/reuses a subject only with sufficient filename/content evidence. New courses use examDate:'',target:80,mastery:0. Unknown/conflicting documents are saved with courseId:'' and do not create a course. 201=new document, 200=raw-byte SHA-256 duplicate. Same filename with different content remains a separate document; a duplicate keeps its existing assignment.
PATCH /api/documents/:id {courseId} -> document. Requires an existing course; manually confirms classification and updates the courseId of linked sourceDocumentId questions and their attempts. Manual card source strings are unchanged.
DELETE /api/documents/:id -> {ok:true}
POST /api/ask {courseId,question} -> {answer:string,sources:[{documentName,page,text}],mode:'retrieval'|'ai'}
GET /api/plan?date=YYYY-MM-DD -> {date,budget,allocated,tasks:[{id,courseId,title,kind:'learn'|'practice'|'review',minutes,reason,completed}],warnings:string[]}
POST /api/tasks/:id/complete {completed:boolean} -> {ok:true}
POST /api/attempts {questionId,selected:number} -> {correct:boolean,explanation,steps,mastery:number}
POST /api/cards/:id/review {rating:1|2|3|4} -> card
POST /api/cards {courseId,front,back,source?} -> card
PATCH /api/settings {dailyMinutes,goal,name} -> settings
POST /api/focus {minutes:number} -> {focusMinutes:number}
GET /api/export -> full state JSON
POST /api/reset {mode:'empty'|'demo'} -> state

Algorithm module server/engine.mjs exports buildPlan(state,dateStr), extractSummary(chunks,locationKind='page'), retrieve(question,documents,courseId), scheduleCard(card,rating,nowDate), updateMastery(current,correct,difficulty). Pure functions. buildPlan returns response above. retrieve returns [{documentName,page,text,score,locationKind}]. scheduleCard returns updated card preserving fields. No IO.

Seed module server/seed.mjs exports createSeed(now=new Date()) -> state with relative future exam dates. Backend owns seed. completedTasks is string[], attempts array. tasks stable by date/course/kind. settings default 150 balanced.

POST /api/questions/generate {courseId} -> {questions:Question[],mode:'source-cloze',warning:string}. Produces up to 8 source-based cloze questions, reuses existing sourceKey to prevent duplicate insertion, returns 422 on insufficient usable passages. Generated questions carry sourceDocumentId, sourcePage, originalSentence and generationMode. Deleting their document also deletes those generated questions and linked attempts; manual card text remains.

Documents and retrieved sources carry locationKind:'page'|'section'. Documents may include warning:string. State may include completedTaskDetails:{[taskId]:Task}, preserving actually completed minutes during replanning. Attempts include counted:boolean to distinguish first-attempt mastery updates from retries.

Classification = {status:'classified'|'needs-review',subject:string|null,confidence:number,reason:string}. confidence in [0,1] is rule evidence strength, not a calibrated probability or a model judgment. New auto documents store classification; both upload routes store contentHash (SHA-256 of original bytes). Legacy documents may have neither property. Max 500 documents, 20 MB per file, 30 courses. Existing manual POST still returns Document directly. Auto classification supports common Chinese university subjects and filename aliases; it does not call an external model or infer exam dates.

Explicitly named child subjects stay separate: C/C++/Python/Java/JavaScript, micro/macro economics, organic/inorganic/physical chemistry, and upper/lower calculus or linear algebra. Generic content rules may classify to the parent subject but do not reuse a different child course. Filename conflicts or multiple child subjects remain needs-review. Unset exam dates produce a request to add the date, with no new scheduled tasks; historical completed task snapshots remain visible.
