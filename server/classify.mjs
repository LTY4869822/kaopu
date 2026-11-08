/** Explainable keyword rules only; confidence is evidence strength, not a calibrated probability. */
const BASE_SUBJECTS = [
  { name: '高等数学', aliases: ['高等数学', '高数', '微积分', 'calculus'], groups: [['导数', '求导', '微分'], ['定积分', '不定积分', '积分'], ['极限', '洛必达'], ['无穷级数', '泰勒级数'], ['偏导数', '重积分']] },
  { name: '线性代数', aliases: ['线性代数', '线代', 'linear algebra'], groups: [['矩阵', '行列式'], ['特征值', '特征向量'], ['线性方程组', '齐次方程组'], ['线性相关', '线性无关'], ['线性空间', '二次型']] },
  { name: '概率论与数理统计', aliases: ['概率论与数理统计', '概率统计', '概率论', '数理统计', '概率与统计'], groups: [['随机变量', '随机事件'], ['概率密度', '分布函数'], ['数学期望', '方差'], ['正态分布', '二项分布'], ['假设检验', '置信区间'], ['大数定律', '中心极限定理']] },
  { name: '大学物理', aliases: ['大学物理', '普通物理', '物理学', '物理', 'physics'], groups: [['牛顿定律', '牛顿第二定律', '受力分析'], ['动能', '机械能', '动量守恒'], ['电场', '磁场', '电磁感应'], ['简谐振动', '波动方程'], ['热力学', '理想气体']] },
  { name: '大学英语', aliases: ['大学英语', '英语', 'college english', 'english'], groups: [['主谓一致', 'subject verb'], ['英语语法', '定语从句', '虚拟语气'], ['reading comprehension', '完形填空'], ['英语词汇', 'vocabulary'], ['英语写作', 'english writing']] },
  { name: '程序设计', aliases: ['程序设计', '程序语言', 'programming'], groups: [['循环语句', 'for循环', 'while循环'], ['函数参数', '函数调用'], ['指针', '数组下标'], ['类与对象', '面向对象', '封装继承'], ['变量类型', '数据类型', '条件语句']] },
  { name: '数据结构', aliases: ['数据结构', 'data structures', 'data structure'], groups: [['链表', '顺序表'], ['二叉树', '平衡树'], ['栈和队列', '队列', '栈'], ['排序算法', '快速排序', '归并排序'], ['图的遍历', '最小生成树'], ['时间复杂度', '空间复杂度']] },
  { name: '计算机组成原理', aliases: ['计算机组成原理', '计算机组成', '计组', 'computer organization'], groups: [['指令周期', '指令系统'], ['运算器', '控制器'], ['cache', '高速缓存'], ['补码', '浮点数表示'], ['总线', '微程序'], ['存储层次', '主存储器']] },
  { name: '操作系统', aliases: ['操作系统', 'operating systems', 'operating system'], groups: [['进程调度', '进程同步'], ['死锁', '银行家算法'], ['虚拟内存', '页面置换'], ['文件系统', '磁盘调度'], ['信号量', '临界区']] },
  { name: '计算机网络', aliases: ['计算机网络', '计网', 'computer networks', 'computer network'], groups: [['tcp', 'udp'], ['ip地址', '子网掩码'], ['网络协议', 'osi模型'], ['路由算法', '路由器'], ['拥塞控制', '滑动窗口'], ['dns', 'http协议']] },
  { name: '数据库', aliases: ['数据库', 'database', 'sql', 'mysql'], groups: [['关系代数', '关系模型'], ['数据库范式', '第三范式', '函数依赖'], ['sql', 'select语句'], ['事务', 'acid'], ['主键', '外键'], ['数据库索引', '数据库设计']] },
  { name: '电路', aliases: ['电路分析', '电路原理', '电路基础', '电路'], groups: [['基尔霍夫', 'kcl', 'kvl'], ['戴维南', '诺顿定理'], ['节点电压', '网孔电流'], ['叠加定理', '电阻电路'], ['正弦稳态', '阻抗', '相量']] },
  { name: '模拟电子技术', aliases: ['模拟电子技术', '模拟电子', '模拟电路', '模电', 'analog electronics'], groups: [['三极管', '晶体管'], ['运算放大器', '集成运放'], ['静态工作点', '放大电路'], ['负反馈', '差分放大'], ['二极管', '整流电路']] },
  { name: '数字电子技术', aliases: ['数字电子技术', '数字电子', '数字电路', '数电', 'digital electronics'], groups: [['逻辑门', '逻辑代数'], ['触发器', '寄存器'], ['卡诺图', '布尔代数'], ['组合逻辑', '时序逻辑'], ['计数器', '译码器']] },
  { name: '化学', aliases: ['大学化学', '普通化学', '无机化学', '有机化学', '物理化学', '化学', 'chemistry'], groups: [['化学平衡', '平衡常数'], ['酸碱', '电离平衡'], ['氧化还原', '化合价'], ['分子结构', '化学键'], ['化学反应', '反应速率'], ['有机物', '官能团']] },
  { name: '马克思主义基本原理', aliases: ['马克思主义基本原理', '马克思主义原理', '马原'], groups: [['唯物辩证法', '辩证唯物主义'], ['剩余价值', '资本主义'], ['认识论', '实践与认识'], ['生产力', '生产关系'], ['矛盾的普遍性', '矛盾的特殊性']] },
  { name: '毛泽东思想和中国特色社会主义理论体系概论', aliases: ['毛泽东思想和中国特色社会主义理论体系概论', '毛概', '毛泽东思想概论'], groups: [['新民主主义革命', '新民主主义理论'], ['社会主义改造', '三大改造'], ['毛泽东思想', '实事求是思想路线'], ['邓小平理论', '三个代表'], ['中国特色社会主义理论体系', '科学发展观']] },
  { name: '思想道德与法治', aliases: ['思想道德与法治', '思想道德修养', '思修', '思想道德与法律基础'], groups: [['人生价值', '人生观'], ['理想信念', '道德修养'], ['社会主义核心价值观', '爱国主义'], ['法治思维', '法律权利与义务'], ['社会公德', '职业道德']] },
  { name: '中国近现代史纲要', aliases: ['中国近现代史纲要', '中国近代史', '中国近现代史', '近代史', '近现代史'], groups: [['鸦片战争', '南京条约'], ['辛亥革命', '戊戌变法'], ['五四运动', '新文化运动'], ['洋务运动', '太平天国'], ['抗日战争', '解放战争']] },
  { name: '管理学', aliases: ['管理学', '管理原理', '管理学原理', '管理', 'management'], groups: [['管理职能', '计划组织领导控制'], ['组织结构', '组织设计'], ['管理决策', '决策过程'], ['激励理论', '马斯洛', '双因素理论'], ['控制职能', '管理幅度']] },
  { name: '经济学', aliases: ['微观经济学', '宏观经济学', '经济学', '经济', 'economics'], groups: [['供给与需求', '供求关系', '需求弹性'], ['边际效用', '消费者均衡'], ['国内生产总值', 'gdp'], ['通货膨胀', '货币政策'], ['市场均衡', '完全竞争'], ['机会成本', '生产可能性曲线']] },
  { name: '会计学', aliases: ['基础会计', '财务会计', '会计学', '会计', 'accounting'], groups: [['借贷记账', '会计分录'], ['资产负债表', '资产负债'], ['会计要素', '会计恒等式'], ['所有者权益', '利润表'], ['权责发生制', '收付实现制'], ['会计凭证', '总账']] },
];

// Explicitly named modules remain independent courses. Content-only evidence
// can identify a parent subject, but must never guess which child course it is.
export const SUBJECTS = [...BASE_SUBJECTS,
  { name: 'C语言程序设计', parent: '程序设计', aliases: ['c语言', 'c语言程序设计'] },
  { name: 'C++程序设计', parent: '程序设计', aliases: ['c++', 'c++程序设计'] },
  { name: 'Python程序设计', parent: '程序设计', aliases: ['python', 'python程序设计'] },
  { name: 'Java程序设计', parent: '程序设计', aliases: ['java', 'java程序设计'] },
  { name: 'JavaScript程序设计', parent: '程序设计', aliases: ['javascript', 'javascript程序设计'] },
  { name: '微观经济学', parent: '经济学', aliases: ['微观经济学', '微观经济', 'microeconomics'] },
  { name: '宏观经济学', parent: '经济学', aliases: ['宏观经济学', '宏观经济', 'macroeconomics'] },
  { name: '有机化学', parent: '化学', aliases: ['有机化学'] },
  { name: '无机化学', parent: '化学', aliases: ['无机化学'] },
  { name: '物理化学', parent: '化学', aliases: ['物理化学', '物化'] },
  ...['上', '下'].flatMap((part) => [
    { name: `高等数学（${part}）`, parent: '高等数学', aliases: [`高等数学${part}`, `高数${part}`, `微积分${part}`] },
    { name: `线性代数（${part}）`, parent: '线性代数', aliases: [`线性代数${part}`, `线代${part}`] },
  ]),
];

const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_.\-()[\]（）【】]+/g, '');
const contains = (text, term) => {
  if (['管理', '经济'].includes(term)) return new RegExp(`^${term}(?:学|原理|基础|期末|复习|笔记|提纲|重点|考试|试题|题库|章节|$)`).test(text);
  if (/^[a-z]{1,3}$/i.test(term)) return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`, 'i').test(text);
  return text.includes(normalize(term));
};

function nameMatches(value) {
  const text = normalize(value);
  const matches = SUBJECTS.flatMap((subject) => subject.aliases.filter((alias) => contains(text, alias)).map((alias) => ({ subject, alias: normalize(alias) })));
  // "模拟电路" and "物理化学" must not also identify 电路 and 物理.
  return matches.filter((match) => !matches.some((other) => other.subject.name !== match.subject.name && ((other.alias.length > match.alias.length && other.alias.includes(match.alias)) || other.subject.parent === match.subject.name)));
}

export function canonicalSubject(value) {
  const matches = [...new Set(nameMatches(value).map((item) => item.subject.name))];
  return matches.length === 1 ? matches[0] : null;
}

export function classifyDocument(filename, chunks, courses = []) {
  const title = String(filename).replace(/\.[^.]+$/, '');
  const filenameMatches = nameMatches(title);
  const namedSubjects = [...new Set(filenameMatches.map((item) => item.subject.name))];
  // Read a bounded sample across the document rather than allowing a long upload
  // to make classification arbitrarily expensive or dominate by repeated words.
  const selected = chunks.length <= 80 ? chunks : Array.from({ length: 80 }, (_, index) => chunks[Math.floor(index * (chunks.length - 1) / 79)]);
  const content = normalize(selected.map((chunk) => String(chunk.text || '').slice(0, 1500)).join('\n'));
  const contentEvidence = BASE_SUBJECTS.map((subject) => {
    const terms = subject.groups.map((group) => group.find((term) => contains(content, term))).filter(Boolean);
    return { subject: subject.name, terms, score: terms.length };
  }).sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject));
  const strongContent = contentEvidence.filter((item) => item.score >= 2);
  const pending = (reason, confidence = 0.25) => ({ status: 'needs-review', subject: null, confidence, reason });
  if (namedSubjects.length > 1) return pending(`文件名同时出现${namedSubjects.join('、')}，可能是多科合并资料，请确认归属。`, 0.35);
  if (namedSubjects.length === 1) {
    const subject = namedSubjects[0];
    const parentSubject = SUBJECTS.find((item) => item.name === subject)?.parent || subject;
    const support = contentEvidence.find((item) => item.subject === parentSubject);
    const contradictory = strongContent.find((item) => item.subject !== parentSubject && (item.score >= support.score + 2 || (item.score >= 3 && support.score >= 2)));
    if (contradictory) return pending(`文件名指向${subject}，但正文包含${contradictory.subject}的多项线索（${contradictory.terms.slice(0, 3).join('、')}），请确认是否混合或命名有误。`, 0.4);
    const aliases = [...new Set(filenameMatches.filter((item) => item.subject.name === subject).map((item) => item.alias))];
    return { status: 'classified', subject, confidence: support.score >= 2 ? 0.98 : 0.94, reason: `文件名包含“${aliases.sort((a, b) => b.length - a.length)[0]}”${support.score ? `，正文也出现${support.terms.slice(0, 3).join('、')}` : ''}；按课程名称规则归档。` };
  }
  // A user-created subject outside the built-in catalog can be identified only
  // by its specific course name in the filename; generic names are not evidence.
  const exactCourses = courses.filter((course) => normalize(course.name).length >= 3 && normalize(title).includes(normalize(course.name)) && !canonicalSubject(course.name));
  if (exactCourses.length > 1) return pending('文件名匹配了多门已有课程，请手动确认归属。', 0.35);
  if (exactCourses.length === 1 && !strongContent.length) return { status: 'classified', subject: exactCourses[0].name, confidence: 0.9, reason: `文件名明确包含已有课程“${exactCourses[0].name}”；按课程名称规则归档。` };
  const best = strongContent[0];
  if (!best) return pending('文件名没有明确科目，正文也缺少两组独立的课程关键词。资料已保存，请手动选择课程。', 0.2);
  const runnerUp = strongContent[1];
  if (runnerUp && (best.score - runnerUp.score < 2 || runnerUp.score >= 3)) return pending(`正文同时包含${best.subject}（${best.terms.slice(0, 3).join('、')}）和${runnerUp.subject}（${runnerUp.terms.slice(0, 3).join('、')}）线索，请确认归属。`, 0.4);
  if (exactCourses.length) return pending(`文件名包含已有课程“${exactCourses[0].name}”，正文关键词却指向${best.subject}，请确认归属。`, 0.4);
  return { status: 'classified', subject: best.subject, confidence: Math.min(0.91, 0.77 + best.score * 0.025), reason: `正文匹配${best.score}组独立关键词：${best.terms.slice(0, 5).join('、')}；按本地关键词规则归档。` };
}

export function findSubjectCourse(subject, filename, courses) {
  const matches = courses.filter((course) => course.name === subject || canonicalSubject(course.name) === subject);
  const exactInFilename = matches.filter((course) => normalize(filename).includes(normalize(course.name)));
  return exactInFilename.sort((a, b) => b.name.length - a.name.length)[0] || matches[0] || null;
}
