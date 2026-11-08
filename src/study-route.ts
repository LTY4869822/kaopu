export const studyPages = ["dashboard", "materials", "lessons", "knowledge", "plan", "practice", "exams", "memory", "resources", "settings"] as const;
export type StudyPage = typeof studyPages[number];
const scopedPages = new Set<StudyPage>(["materials", "lessons", "practice", "exams"]);
export function readStudyRoute(href: string): { page: StudyPage; course: string } {
  const url = new URL(href), requested = url.searchParams.get("page");
  const page = studyPages.includes(requested as StudyPage) ? requested as StudyPage : "dashboard";
  const course = url.searchParams.get("course");
  return { page, course: scopedPages.has(page) && course && course.length <= 200 ? course : "all" };
}
export function studyRouteUrl(href: string, page: StudyPage, course: string): string {
  const url = new URL(href);
  if (page === "dashboard") url.searchParams.delete("page"); else url.searchParams.set("page", page);
  if (scopedPages.has(page) && course !== "all") url.searchParams.set("course", course); else url.searchParams.delete("course");
  url.searchParams.delete("intro"); url.hash = "";
  return url.href;
}
