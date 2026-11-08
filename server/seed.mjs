const localDate = (date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(date);

/** Demo dates are relative to first launch, never presented as a real university timetable. */
export function createSeed(now = new Date()) {
  const day = (offset) => localDate(new Date(now.getTime() + offset * 86400000));
  const createdAt = now.toISOString();
  const courses = [
    { id: 'math', name: '高等数学', examDate: day(10), target: 85, mastery: 42, color: 'green', icon: 'function', chapters: 8, description: '极限 · 导数 · 积分', isDemo: true },
    { id: 'linear', name: '线性代数', examDate: day(15), target: 80, mastery: 58, color: 'blue', icon: 'matrix', chapters: 6, description: '矩阵 · 线性方程组 · 特征值', isDemo: true },
    { id: 'physics', name: '大学物理', examDate: day(19), target: 80, mastery: 36, color: 'orange', icon: 'atom', chapters: 10, description: '力学 · 电磁学 · 波动', isDemo: true },
    { id: 'english', name: '大学英语', examDate: day(24), target: 85, mastery: 72, color: 'purple', icon: 'language', chapters: 8, description: '词汇 · 阅读 · 写作', isDemo: true },
  ];
  const documents = [
    {
      id: 'doc-math', courseId: 'math', name: '高等数学 · 核心概念与典型题.pdf', type: 'PDF', size: 248320,
      chunks: [
        { id: 'math-p1', page: 1, text: '【产品示例资料，非学校考试大纲】极限与连续：极限描述自变量趋近某点时函数值的趋势。函数在点 a 连续要求 f(a) 有定义、当 x 趋于 a 时极限存在、该极限等于 f(a)。重要极限：lim(x→0) sin(x)/x = 1（弧度制）。等价无穷小替换通常用于乘除结构，不能不加判断地替换加减结构。' },
        { id: 'math-p2', page: 2, text: '导数与复合函数：导数是瞬时变化率，几何意义是切线斜率。链式法则：若 y=f(g(x))，则 y′=f′(g(x))·g′(x)。例如 y=sin(x²)，先对外层 sin 求导得到 cos(x²)，再乘内层 x² 的导数 2x，结果 y′=2x cos(x²)。易错点是漏乘内层导数。' },
        { id: 'math-p3', page: 3, text: '定积分与换元：∫₀¹ 2x dx = [x²]₀¹ = 1。积分可表示带符号面积；在整个区间非负时等于曲边梯形面积。换元积分必须同时替换微分，并在定积分中同步改变积分上下限。分部积分：∫u dv = uv − ∫v du，选择 u 时可优先考虑求导后会变简单的因子。' },
        { id: 'math-p4', page: 4, text: '洛必达法则：仅能在适用条件满足时处理 0/0 或 ∞/∞ 型极限。先确认未定式，再检查可导等条件；不能把分子的和与分母的和逐项相除。例：lim(x→0)(eˣ−1)/x = lim(x→0)eˣ/1 = 1。学习建议：每学一种方法，先说清适用条件，再做一题反例辨析。' },
      ], summary: ['复合函数求导：外层导数 × 内层导数', '定积分换元时，微分与上下限一起变', '洛必达法则先判断未定式与适用条件'],
    },
    {
      id: 'doc-linear', courseId: 'linear', name: '线性代数 · 知识框架.docx', type: 'DOCX', size: 104448,
      chunks: [
        { id: 'linear-s1', page: 1, text: '【产品示例资料，非学校考试大纲】矩阵乘法通常不满足交换律，AB 不一定等于 BA。矩阵 A 可逆当且仅当 det(A)≠0。二阶矩阵 [[a,b],[c,d]] 的行列式为 ad−bc。求逆矩阵可用增广矩阵 [A|I] 经初等行变换化成 [I|A⁻¹]。' },
        { id: 'linear-s2', page: 2, text: '线性方程组 Ax=b：有解的充要条件是 r(A)=r(A|b)。若共同秩等于未知数个数 n，则唯一解；若共同秩小于 n，则无穷多解。齐次方程组 Ax=0 必有零解，存在非零解当且仅当 r(A)<n。' },
        { id: 'linear-s3', page: 3, text: '特征值和特征向量：Av=λv 且 v≠0。求解步骤：先解 det(A−λI)=0，再对每个 λ 解 (A−λI)v=0。对角矩阵的特征值就是对角元素。不同特征值对应的特征向量线性无关。非零特征向量条件不能省略。' },
      ], summary: ['方程组先比较系数矩阵与增广矩阵的秩', '可逆 ⇔ 行列式非零', '特征值先解特征方程，再求非零特征向量'],
    },
    {
      id: 'doc-physics', courseId: 'physics', name: '大学物理 · 力学复习提纲.pptx', type: 'PPTX', size: 516096,
      chunks: [
        { id: 'physics-p1', page: 1, text: '【产品示例资料，非学校考试大纲】牛顿第二定律：在惯性参考系、质量不变的情况下，合外力 F=ma。分析步骤：选研究对象，画受力图，选坐标系，列各方向方程。加速度方向与合力方向相同，而不一定与速度方向相同。' },
        { id: 'physics-p2', page: 2, text: '功与能：恒力做功 W=Fs cosθ，其中 θ 为力与位移的夹角。动能 Ek=½mv²，合外力做功等于动能变化。机械能守恒的常用条件是只有重力或弹性力做功；存在摩擦耗散时，应计入内能变化，不能直接套用机械能守恒。' },
        { id: 'physics-p3', page: 3, text: '电场基础：匀强电场中电场力 F=qE，正电荷受力方向沿电场方向，负电荷相反。电势能变化 ΔEp=qΔV，电场力做功 W=−ΔEp。分析公式时同时检查量纲与正负号，可排除许多计算错误。' },
      ], summary: ['先画受力图，再列方程', '机械能守恒需要检查做功条件', '计算结果同时检查量纲和方向'],
    },
    {
      id: 'doc-english', courseId: 'english', name: '大学英语 · 易混词与阅读策略.pdf', type: 'PDF', size: 172032,
      chunks: [
        { id: 'english-p1', page: 1, text: '【产品示例资料，非学校考试大纲】词汇辨析：affect 常用作动词，表示影响；effect 常用作名词，表示效果、影响。例如 Sleep affects memory. / Sleep has an effect on memory. 记忆时使用句子回忆和间隔复习，比只反复看词表更容易检验是否真正记住。' },
        { id: 'english-p2', page: 2, text: '阅读策略：先判断题目问的是主旨、细节、推断还是词义，再回到文章寻找证据。however、yet、nevertheless 常提示转折；therefore、thus 常提示结果。推断题的结论必须由原文支持，不能把自己的背景知识直接当作答案。' },
        { id: 'english-p3', page: 3, text: '写作与语法：主谓一致要识别真正的主语，不能只看离谓语最近的名词。例：The quality of these products is good. 主语核心是单数 quality，因此使用 is。写作复查顺序可为：任务要求、段落逻辑、主谓与时态、拼写标点。' },
      ], summary: ['词汇放进例句中主动回忆', '阅读选项必须能在原文找到依据', '主谓一致先找到主语核心词'],
    },
  ].map((doc) => ({ ...doc, createdAt, status: 'ready', isDemo: true }));
  const question = (id, courseId, topic, prompt, options, answer, explanation, steps, difficulty = '基础') =>
    ({ id, courseId, topic, prompt, options, answer, explanation, steps, difficulty, source: '考谱自编示例题 · 用于体验练习流程' });
  const questions = [
    question('q-math-1', 'math', '复合函数求导', '设 f(x) = sin(x²)，则 f′(x) 等于？', ['cos(x²)', '2x cos(x²)', '2 sin(x)', 'cos(2x)'], 1, '这是复合函数，必须同时对外层和内层求导。', ['把 x² 看作内层 u，得到 f=sin(u)。', '外层导数为 cos(u)，内层导数为 2x。', '相乘并代回 u=x²，得到 2x cos(x²)。'], '中等'),
    question('q-math-2', 'math', '定积分', '定积分 ∫₀¹ 2x dx 的值为？', ['0', '1/2', '1', '2'], 2, '2x 的一个原函数是 x²。代入上下限相减即可。', ['求原函数 F(x)=x²。', '由牛顿—莱布尼茨公式计算 F(1)−F(0)。', '结果为 1²−0²=1。']),
    question('q-math-3', 'math', '极限', '当 x→0 时，(eˣ−1)/x 的极限为？', ['0', '1', 'e', '不存在'], 1, '分子分母都趋于 0，且满足洛必达法则的适用条件，求导后的比值趋于 1。', ['代入判断为 0/0 型未定式。', '分子与分母分别求导，得到 eˣ/1。', '令 x→0，结果为 e⁰=1。']),
    question('q-linear-1', 'linear', '矩阵与行列式', '矩阵 A = [[1, 2], [3, 4]] 的行列式为？', ['2', '−2', '10', '−10'], 1, '二阶行列式等于主对角线乘积减去副对角线乘积。', ['主对角线乘积为 1×4=4。', '副对角线乘积为 2×3=6。', 'det(A)=4−6=−2；非零，因此 A 可逆。']),
    question('q-linear-2', 'linear', '线性方程组', '含 3 个未知数的方程组 Ax=b，已知 r(A)=r(A|b)=2，则该方程组？', ['无解', '有唯一解', '有无穷多解', '只有零解'], 2, '两种秩相等说明有解；秩小于未知数个数说明存在自由变量。', ['r(A)=r(A|b)，所以方程组有解。', '共同秩 2 小于未知数个数 3。', '有 1 个自由变量，因此有无穷多解。'], '中等'),
    question('q-physics-1', 'physics', '牛顿第二定律', '质量为 2 kg 的物体在惯性系中受到 6 N 的合外力，其加速度大小为？', ['3 m/s²', '12 m/s²', '0.33 m/s²', '8 m/s²'], 0, '使用合外力与质量计算加速度 a=F/m。', ['确认题目给的是合外力，单位为 N。', '代入牛顿第二定律 a=6/2。', '得 a=3 m/s²，方向与合外力一致。']),
    question('q-physics-2', 'physics', '动能定理', '质量不变的物体，速度大小变为原来的 2 倍，其动能变为原来的？', ['2 倍', '4 倍', '1/2 倍', '不变'], 1, '动能 Ek=½mv²，在质量不变时与速度的平方成正比。', ['写出初态 Ek=½mv²。', '末态 Ek′=½m(2v)²。', '整理得 Ek′=4Ek。']),
    question('q-english-1', 'english', '主谓一致', 'Choose the correct word: The quality of these products ___ good.', ['are', 'were', 'is', 'have'], 2, '句子的主语核心是单数 quality，of these products 是修饰语，因此用 is。', ['定位主语核心词 quality。', '排除介词短语 of these products 的干扰。', '单数主语对应 is。']),
    question('q-english-2', 'english', '阅读逻辑', '在阅读中，however 通常提示哪种逻辑关系？', ['递进', '因果', '转折', '举例'], 2, 'however 常用于引入与前文形成对照或转折的信息。', ['识别连接词 however。', '留意前后观点或事实发生的变化。', '把转折后的信息与题目对应，回到原文验证。']),
  ];
  const cards = [
    { id: 'card-1', courseId: 'math', front: '复合函数 f(g(x)) 的求导公式是什么？', back: 'f′(g(x)) · g′(x)。先对外层求导，再乘内层导数。例：sin(x²) 的导数是 2x cos(x²)。', source: '示例资料 · 高等数学，第 2 页' },
    { id: 'card-2', courseId: 'math', front: '定积分换元时，除了被积函数还要改变什么？', back: '必须同时替换微分；如果直接按新变量计算定积分，还必须改变上下限。', source: '示例资料 · 高等数学，第 3 页' },
    { id: 'card-3', courseId: 'linear', front: 'Ax=b 有解的充要条件是什么？', back: 'r(A)=r(A|b)。如果共同秩等于未知数个数则唯一解，小于未知数个数则无穷多解。', source: '示例资料 · 线性代数，第 2 节' },
    { id: 'card-4', courseId: 'physics', front: '使用机械能守恒前要检查什么？', back: '常用条件是只有重力或弹性力做功。若有摩擦等非保守力做功，应计入相应能量转化，不能直接认为机械能守恒。', source: '示例资料 · 大学物理，第 2 页' },
    { id: 'card-5', courseId: 'english', front: 'affect 与 effect 的常见词性和用法有什么区别？', back: 'affect 常作动词：Sleep affects memory. effect 常作名词：Sleep has an effect on memory. 两者也存在其他词性用法，需结合语境。', source: '示例资料 · 大学英语，第 1 页' },
    { id: 'card-6', courseId: 'english', front: 'The quality of these products ___ good. 为什么填 is？', back: '主语核心是单数 quality，而非 products。of these products 是介词短语，不能决定谓语的单复数。', source: '示例资料 · 大学英语，第 3 页' },
  ].map((card) => ({ ...card, due: createdAt }));
  return { courses, documents, cards, questions, attempts: [], settings: { dailyMinutes: 150, goal: 'balanced', name: '同学' }, completedTasks: [], completedTaskDetails: {}, focusMinutes: 0 };
}

export function createEmpty() {
  return { courses: [], documents: [], cards: [], questions: [], attempts: [], settings: { dailyMinutes: 150, goal: 'balanced', name: '同学' }, completedTasks: [], completedTaskDetails: {}, focusMinutes: 0 };
}
