const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage({ title, description, body, site, current = "" }) {
  const currentAttr = (key) => (current === key ? ' aria-current="page"' : "");

  return `<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(description)}">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" type="text/css" href="css/style.css">
</head>

<body>

    <!-- 顶部导航栏 -->
    <nav class="navbar" aria-label="主导航">
        <div class="navbar-links">
            <a href="index.html"${currentAttr("home")}>首页</a>
            <a href="archive.html"${currentAttr("archive")}>归档</a>
        </div>
    </nav>

    <div class="layout">
${body}
    </div>

    <footer>
        <p>© ${new Date().getFullYear()} ${escapeHtml(site.name)}</p>
    </footer>

</body>

</html>`;
}

function renderPostCard(post) {
  return (
    '        <article class="post">\n' +
    '            <h2><a href="' +
    escapeHtml(post.link) +
    '">' +
    escapeHtml(post.title) +
    "</a></h2>\n" +
    '            <p class="post-meta"><time datetime="' +
    post.date +
    '">' +
    post.date +
    "</time></p>\n" +
    '            <p class="post-desc">' +
    escapeHtml(post.description) +
    "</p>\n" +
    "        </article>"
  );
}

function buildIndex(posts, site) {
  const templatePath = path.join(ROOT_DIR, "index.template.html");
  const indexPath = path.join(ROOT_DIR, "index.html");

  if (!fs.existsSync(templatePath)) {
    console.warn("未找到 index.template.html，跳过首页生成");
    return;
  }

  const listHtml =
    posts.length > 0
      ? posts.map(renderPostCard).join("\n\n")
      : '        <p class="empty">还没有文章</p>';

  const html = fs
    .readFileSync(templatePath, "utf-8")
    .replace("<!--POST_LIST-->", () => listHtml)
    .replace("<!--YEAR-->", () => String(new Date().getFullYear()));

  fs.writeFileSync(indexPath, html, "utf-8");
  console.log("生成首页：" + indexPath);

  buildArchive(posts, site);
  build404(site);
}

function buildArchive(posts, site) {
  const groups = new Map();

  for (const post of posts) {
    const year = post.date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(post);
  }

  const sections =
    groups.size === 0
      ? '        <p class="empty">还没有文章</p>'
      : Array.from(groups.entries())
          .map(([year, items]) => {
            const list = items
              .map(
                (post) =>
                  '                <li><time datetime="' +
                  post.date +
                  '">' +
                  post.date +
                  '</time><a href="' +
                  escapeHtml(post.link) +
                  '">' +
                  escapeHtml(post.title) +
                  "</a></li>"
              )
              .join("\n");

            return (
              '        <section class="archive-year">\n' +
              "            <h2>" +
              year +
              "</h2>\n" +
              '            <ul>\n' +
              list +
              "\n            </ul>\n" +
              "        </section>"
            );
          })
          .join("\n");

  const body =
    '        <main class="content">\n' +
    '            <h1 class="page-title">归档</h1>\n' +
    "            <p class=\"page-desc\">共 " +
    posts.length +
    " 篇文章</p>\n" +
    '            <div class="archive">\n' +
    sections +
    "\n            </div>\n" +
    "        </main>";

  const html = renderPage({
    title: "归档 - " + site.name,
    description: "全部文章归档，共 " + posts.length + " 篇。",
    body,
    site,
    current: "archive",
  });

  fs.writeFileSync(path.join(ROOT_DIR, "archive.html"), html, "utf-8");
  console.log("生成归档页：" + path.join(ROOT_DIR, "archive.html"));
}

function build404(site) {
  const body =
    '        <main class="content">\n' +
    '            <h1 class="page-title">404</h1>\n' +
    "            <p class=\"page-desc\">你访问的页面不存在，可能已被移动或删除。</p>\n" +
    '            <p><a class="button-link" href="index.html">返回首页</a></p>\n' +
    "        </main>";

  const html = renderPage({
    title: "页面不存在 - " + site.name,
    description: "页面不存在。",
    body,
    site,
  });

  fs.writeFileSync(path.join(ROOT_DIR, "404.html"), html, "utf-8");
  console.log("生成 404 页：" + path.join(ROOT_DIR, "404.html"));
}

module.exports = { buildIndex };
