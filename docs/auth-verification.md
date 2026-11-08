# 注册登录入口验证

## 当前运行版：恢复人脸近景（2026-11-04）

根据用户最新澄清，运行入口恢复为最初只露孔子人脸的近景版，使用public/sites/good-fella-com-0c318826/root-8a5edab2/中的confucius-sculpture.png与confucius-depth.png。本轮构建与浏览器检查已通过（7组检查、14个布局、12个WebGL像素检查），下列校园全身立像验证均为历史记录。

## 校园全身孔子立像替换（2026-11-04，历史版本）

用户确认以白色校园拱手立像为参考，已将运行素材替换为public/portraits中的独立生成全身石像与配套深度估计。头冠、拱手、宽袖、长袍、鞋与低石座完整保留。桌面及手机分别调整了占位与字符密度，图片采用原生alpha。

- `npm run build`通过。
- `node scripts/statue-smoke.mjs`通过7组检查、14个布局与12个真实WebGL像素检查。覆盖1440/1024桌面、768平板及390/320手机，头脚在画面内，不与页脚或手机标题重叠。
- 实际shader输出可见ASCII像素，验证hover引起深度与字符变化、点击切换橙色/石色、暂停停帧、减少动态偏好静态与即时切色，以及强制无WebGL图片回退。
- 登录/注册表单可读，无横向溢出，图片404、页面异常、console错误及账户写入均为0。测试mock了API，不使用或修改真实账户。
- 已实际打开核对docs/screenshots/statue-desktop.png、statue-mobile-390.png、statue-silver.png、statue-login-390.png；报告test-results/statue/report.json。
- 造型参考、生成prompt及深度图边界见docs/research/campus-confucius/README.md和素材旁的.png.json。深度是艺术估计，不是精确3D扫描。

## 之前的入口重做记录

2026-11-04。用户反馈后依照 clone-website 技能重做 Good Fella 开场质感。来源 https://good-fella.com/，原站源码仅作研究，生产页面使用独立 WebGL 实现和新生成孔子资产。

- TypeScript + Vite production build: passed.
- Node suite: 32 passed. Includes auth lifecycle, validation, timing, persistence, expiry, rate limiting, CSRF origin checks and Vite runtime-data denial.
- Browser: 1440×900 desktop and 390×844 mobile. No horizontal overflow; intro, login, registration inspected visually.
- Separate temporary backend http://localhost:3002: registered disposable preview@example.test account, reached real study dashboard, logged out, saw wrong-password error, logged in correctly, reloaded and retained session. Real data/ and real owner account were not used by these tests.
- Click color switch verified orange → silver. Reference's fixed ASCII-grid mechanism replaced prior repulsion simulation. Paused/reduced-motion and visibility handling implemented.
- Browser console: no errors or warnings on final development page (expected failed login HTTP response on isolated test).

## Boundaries

Source image is a custom Confucius sculpture, not the original Girl; depth is an image-generated approximation. Chinese headings use system sans rather than the reference's licensed Latin typeface. Mobile layout adapts the composition to forms. This is a close reconstruction of the reference interaction, not a claim of pixel-identical original artwork.

Final screenshots in docs/design-references/good-fella-com-0c318826/root-8a5edab2/.

## Asset generation

Built-in imagegen used, no CLI fallback. Project assets:
public/sites/good-fella-com-0c318826/root-8a5edab2/confucius-sculpture.png
public/sites/good-fella-com-0c318826/root-8a5edab2/confucius-depth.png

Portrait prompt: refined monumental sculptural bust of Confucius, harmonious Chinese face, high forehead, serene eyes, traditional topknot, elegant tapered beard, pale alabaster, three-quarter view facing left, strong upper-left chiaroscuro, black backdrop, head-and-shoulders vertical 2:3, broad smooth facial volumes for sparse ASCII conversion, no hands/text/frame/caricature.

Depth edit prompt: preserve exact portrait composition and silhouette; estimate geometric camera distance in smooth grayscale (nose/near cheek lightest, forehead light, outer head/beard mid-gray, shoulders dark, background black); ignore original surface texture and lighting; no change of viewpoint or features. Generated depth estimate is artistic, not calibrated geometry.
