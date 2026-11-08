import { useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarBlank, DotsThree, Files, FolderOpen, MagnifyingGlass, Plus, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import type { Course, Doc } from './types';
import './course-catalog.css';

export type CourseCatalogProps = {
  courses: Course[];
  documents: Doc[];
  search: string;
  onOpenCourse: (id: string) => void;
  onEditCourse: (course: Course) => void;
  onAddCourse: () => void;
  onImport: () => void;
  onReviewUnassigned: () => void;
};

const coverNames = ['math', 'linear', 'physics', 'language', 'computing', 'circuits', 'humanities', 'science'];

/** Subject families select original geometric covers; unknown courses stay stable across renders. */
export function getCourseCover(name: string) {
  const subject = name.normalize('NFKC').toLowerCase();
  let cover: string;
  if (/线性代数|线代|linear\s*algebra/.test(subject)) cover = 'linear';
  else if (/化学|生物|生命|医学|材料|chemistry|biology/.test(subject)) cover = 'science';
  else if (/电路|电子|模电|数电|电工|circuits/.test(subject)) cover = 'circuits';
  else if (/程序|计算机|数据结构|数据库|操作系统|软件|算法|c语言|python|java|c\+\+|网络|计组|计网/.test(subject)) cover = 'computing';
  else if (/英语|日语|法语|德语|外语|english|language/.test(subject)) cover = 'language';
  else if (/数学|高数|微积分|概率|统计|calculus/.test(subject)) cover = 'math';
  else if (/物理|力学|光学|电磁|physics/.test(subject)) cover = 'physics';
  else if (/政治|历史|近代史|近现代史|马原|毛概|思修|思想|马克思|文学|哲学|法学|管理|经济|会计|财务|教育|人文/.test(subject)) cover = 'humanities';
  else {
    const stableHash = [...subject].reduce((sum, char) => (sum * 31 + (char.codePointAt(0) || 0)) >>> 0, 0);
    cover = coverNames[stableHash % coverNames.length];
  }
  return `/course-covers/${cover}.svg`;
}

function validExamDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function examDetail(examDate: string) {
  const date = validExamDate(examDate);
  if (!date) return { dateLabel: '待设置考试日期', status: '按你的节奏准备', tone: 'undated' };
  const today = new Date();
  const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const dateLabel = `${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(date)}考试`;
  if (days < 0) return { dateLabel, status: '考试已结束', tone: 'finished' };
  if (days === 0) return { dateLabel, status: '今天考试', tone: 'soon' };
  return { dateLabel, status: days <= 7 ? `还剩 ${days} 天` : `${days} 天后考试`, tone: days <= 7 ? 'soon' : 'upcoming' };
}

export function CourseCatalog({ courses, documents, search, onOpenCourse, onEditCourse, onAddCourse, onImport, onReviewUnassigned }: CourseCatalogProps) {
  const [sort, setSort] = useState('default');
  const courseIds = new Set(courses.map((course) => course.id));
  const unassigned = documents.filter((document) => !document.courseId || !courseIds.has(document.courseId));
  const query = search.trim().toLocaleLowerCase();
  const visibleCourses = courses.filter((course) => !query || course.name.toLocaleLowerCase().includes(query) || documents.some((document) => document.courseId === course.id && document.name.toLocaleLowerCase().includes(query)));
  if (sort === 'name') visibleCourses.sort((first, second) => first.name.localeCompare(second.name, 'zh-CN', { numeric: true }));
  if (sort === 'exam') visibleCourses.sort((first, second) => (validExamDate(first.examDate)?.getTime() ?? Infinity) - (validExamDate(second.examDate)?.getTime() ?? Infinity) || first.name.localeCompare(second.name, 'zh-CN', { numeric: true }));
  const documentCounts = new Map<string, number>();
  for (const document of documents) {
    if (document.courseId) documentCounts.set(document.courseId, (documentCounts.get(document.courseId) || 0) + 1);
  }

  return <section className="course-catalog" aria-label="课程资料库">
    {unassigned.length > 0 && <div className="catalog-pending-note" role="status">
      <WarningCircle size={19} aria-hidden="true" />
      <span><strong>{unassigned.length} 份资料</strong>还需要确认课程归属</span>
      <button type="button" onClick={onReviewUnassigned}>去归档<ArrowRight size={15} aria-hidden="true" /></button>
    </div>}

    {courses.length > 0 && <div className="catalog-toolbar">
      <p className="catalog-heading">{query ? '搜索结果' : '全部课程'}<strong>{visibleCourses.length}</strong>{query && <span className="catalog-query-note">按课程或资料名称搜索</span>}</p>
      <div className="catalog-tools">
        <select className="catalog-sort" aria-label="课程排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="default">默认顺序</option><option value="name">按名称排序</option><option value="exam">按考试日期排序</option></select>
        <button type="button" className="catalog-add" onClick={onAddCourse}><Plus size={17} aria-hidden="true" />新建课程</button>
      </div>
    </div>}

    {visibleCourses.length > 0 ? <div className="course-catalog-grid">
      {visibleCourses.map((course) => {
        const exam = examDetail(course.examDate);
        return <article className="course-tile" key={course.id}>
        <button type="button" className="course-tile-main" onClick={() => onOpenCourse(course.id)} aria-label={`打开${course.name}`}>
          <div className="course-tile-cover">
            <span className="course-tile-book">
              <span className="course-book-pages" aria-hidden="true" />
              <img src={getCourseCover(course.name)} alt="" width="640" height="360" loading="lazy" decoding="async" />
              <span className="course-book-spine" aria-hidden="true" />
              <span className="course-book-sheen" aria-hidden="true" />
            </span>
            <span className="course-tile-enter" aria-hidden="true"><ArrowUpRight size={23} /></span>
          </div>
          <div className="course-tile-body">
            <div className="course-tile-kind"><span>课程工作台</span>{course.isDemo && <span className="course-tile-demo">示例</span>}</div>
            <h2 className="course-tile-title" title={course.name}>{course.name}</h2>
            <span className={`course-exam-state is-${exam.tone}`}>{exam.status}</span>
            <div className="course-tile-meta">
              <span><Files size={16} aria-hidden="true" />{documentCounts.get(course.id) || 0} 份资料</span>
              <span title={course.examDate || undefined}><CalendarBlank size={16} aria-hidden="true" />{exam.dateLabel}</span>
            </div>
          </div>
        </button>
        <button type="button" className="course-tile-edit" onClick={() => onEditCourse(course)} aria-label={`编辑${course.name}`} title="编辑课程"><DotsThree size={23} weight="bold" aria-hidden="true" /></button>
      </article>; })}
    </div> : courses.length > 0 ? <div className="catalog-empty catalog-empty-search">
      <MagnifyingGlass size={34} weight="light" aria-hidden="true" />
      <h2>没有找到匹配的课程</h2>
      <p>试试更短的课程名或资料名。</p>
    </div> : <div className="catalog-empty">
      <FolderOpen size={42} weight="light" aria-hidden="true" />
      <h2>把资料交给考谱，课程就有了起点</h2>
      <p>上传讲义、课件或复习笔记，分析后会按学科整理到这里。</p>
      <div className="catalog-empty-actions">
        <button type="button" className="primary" onClick={onImport}><UploadSimple size={18} aria-hidden="true" />上传资料</button>
        <button type="button" className="catalog-add" onClick={onAddCourse}><Plus size={17} aria-hidden="true" />新建课程</button>
      </div>
    </div>}
  </section>;
}

export default CourseCatalog;
