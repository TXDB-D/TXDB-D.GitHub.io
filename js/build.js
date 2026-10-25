const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const hljs = require("highlight.js");

const ROOT_DIR = path.join(__dirname, "..");
const POSTS_DIR = path.join(ROOT_DIR, "posts");
const IMAGES_DIR = path.join(POSTS_DIR, "images");

const SITE = {
  name: "博客",
  description: "记录技术学习与日常笔记的静态博客",
};

/* ------------------------------ 通用工具 ------------------------------ */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

// 把 Obsidian 图片语法 ![[images/x.png]] 统一成标准 Markdown 图片语法
function preprocessMarkdown(md) {
  return md.replace(/!\[\[([^\]]+?\.(?:png|jpe?g|gif|webp|svg|bmp))\]\]/gi, (match, src) => {
    const fileName = src.replace(/^.*\//, "");
    return "![" + fileName + "](images/" + fileName + ")";
  });
}

// 去掉行内 Markdown 标记，得到纯文本
function stripInline(text) {
  return String(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 取正文第一个一级标题作为文章标题，没有则退回文件名
function extractTitle(md, fallbackTitle) {
  const match = md.match(/^#\s+(.+?)\s*$/m);
  return match ? stripInline(match[1]) || fallbackTitle : fallbackTitle;
}

// 去掉正文里的一级标题，避免与页面标题重复
function stripArticleTitle(md) {
  return md.replace(/^#\s+.*(?:\r?\n+|$)/m, "");
}

// 取正文前几段里最长的一段作为摘要
function extractDescription(md) {
  // 标题行不参与摘要，避免混入章节名
  const blocks = md.replace(/^#{1,6}\s+.*$/gm, "").split(/\n\s*\n/);
  const candidates = [];

  for (const block of blocks) {
    if (candidates.length >= 3) break;

    const text = block.trim();
    if (!text) continue;
    if (/^(#{1,6}\s|```|!\[|[-*+]\s|\d+\.\s|\||>)/.test(text)) continue;

    const plain = stripInline(text);
    if (plain.length >= 20) candidates.push(plain);
  }

  if (candidates.length === 0) return "";

  const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.length > 150 ? longest.slice(0, 150) + "..." : longest;
}

/* ------------------------------ 图片处理 ------------------------------ */

function readImageSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // PNG: 第 16-24 字节为宽高
    if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch (err) {
    // 读取失败时不输出尺寸，交由浏览器自行计算
  }
  return null;
}

function findImageSource(href, mdFileDir) {
  const fileName = path.basename(href);
  const candidates = [
    path.join(mdFileDir, href),
    path.join(POSTS_DIR, href),
    path.join(ROOT_DIR, href),
    path.join(mdFileDir, fileName),
    path.join(POSTS_DIR, fileName),
    path.join(ROOT_DIR, "images", fileName),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// 把本地图片复制到 posts/images，并返回可用的 src 与宽高
function prepareImage(href, mdFileDir) {
  if (typeof href !== "string" || !href) return null;

  // 外链、data URI、绝对路径保持原样
  if (/^(https?:|data:)/i.test(href) || path.isAbsolute(href)) {
    return { url: href };
  }

  const fileName = path.basename(href);
  const destPath = path.join(IMAGES_DIR, fileName);
  const sourcePath = findImageSource(href, mdFileDir);

  if (!sourcePath) {
    console.warn('警告：未找到图片源文件 "' + href + '"，跳过复制');
  } else if (!fs.existsSync(destPath)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.copyFileSync(sourcePath, destPath);
    console.log("复制图片：" + sourcePath + " -> " + destPath);
  }

  const size = sourcePath ? readImageSize(sourcePath) : null;

  return {
    url: "./images/" + fileName,
    width: size && size.width,
    height: size && size.height,
  };
}

/* ------------------------------ Markdown 渲染 ------------------------------ */

function createRenderer(mdFileDir, toc) {
  const renderer = new marked.Renderer();
  let imageCount = 0;
  let headingCount = 0;

  // 标题 id 在渲染阶段直接写入，避免事后字符串替换失败
  renderer.heading = function ({ tokens, depth }) {
    const inner = this.parser.parseInline(tokens);
    const plain = inner.replace(/<[^>]+>/g, "").trim();
    const id = depth >= 2 ? "heading-" + headingCount++ : "";

    if (depth >= 2 && depth <= 3) {
      toc.push({ depth, title: plain, id });
    }

    return "<h" + depth + (id ? ' id="' + id + '"' : "") + ">" + inner + "</h" + depth + ">";
  };

  renderer.image = function ({ href, title, text }) {
    const info = prepareImage(href, mdFileDir);
    if (!info) return "";

    const attrs = [
      'src="' + escapeHtml(info.url) + '"',
      'alt="' + escapeHtml(text || "") + '"',
    ];

    if (title) attrs.push('title="' + escapeHtml(title) + '"');
    if (info.width && info.height) {
      attrs.push('width="' + info.width + '"', 'height="' + info.height + '"');
    }

    // 首屏第一张图优先加载，其余懒加载
    attrs.push(imageCount++ === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"');
    attrs.push('decoding="async"');

    return "<img " + attrs.join(" ") + " />";
  };

  // marked 新版本已移除 highlight 选项，改为在 code 渲染器中高亮
  renderer.code = function ({ text, lang }) {
    const language = (lang || "").trim().split(/\s+/)[0];
    const highlighted =
      language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;

    const cls = language ? "hljs language-" + escapeHtml(language) : "hljs";
    return '<pre><code class="' + cls + '">' + highlighted + "</code></pre>";
  };

  return renderer;
}

function renderToc(toc) {
  if (toc.length === 0) return "";

  const items = toc
    .map(
      (item) =>
        '            <li class="toc-level-' +
        item.depth +
        '"><a href="#' +
        item.id +
        '">' +
        escapeHtml(item.title) +
        "</a></li>"
    )
    .join("\n");

  return (
    '        <aside class="article-toc" aria-label="文章目录">\n' +
    '            <h2 class="toc-title">目录</h2>\n' +
    "            <ul>\n" +
    items +
    "\n            </ul>\n" +
    "        </aside>"
  );
}

// 让宽表格可以横向滚动，避免撑破页面
function wrapTables(html) {
  return html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

/* ------------------------------ 页面生成 ------------------------------ */

function renderPostPage({ title, description, date, tocHtml, content }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(description || SITE.description)}">
    <title>${escapeHtml(title)} - ${escapeHtml(SITE.name)}</title>
    <link rel="stylesheet" type="text/css" href="../css/style.css">
    <link rel="stylesheet" type="text/css" href="../css/vs-dark.css">
</head>

<body>

    <!-- 顶部导航栏 -->
    <nav class="navbar" aria-label="主导航">
        <div class="navbar-links">
            <a href="../index.html">首页</a>
            <a href="../archive.html">归档</a>
        </div>
    </nav>

    <!-- 主体布局 -->
    <div class="layout">
${tocHtml}
        <main class="content">
            <article class="post">
                <header class="post-header">
                    <h1>${escapeHtml(title)}</h1>
                    <p class="post-meta"><time datetime="${date}">${date}</time></p>
                </header>
                <div class="post-content">
${content}
                </div>
            </article>
        </main>

    </div>

    <footer>
        <p>© ${new Date().getFullYear()} ${escapeHtml(SITE.name)}</p>
    </footer>

</body>

</html>`;
}

function buildPost(mdPath, posts) {
  let md = fs.readFileSync(mdPath, "utf-8");
  md = preprocessMarkdown(md);

  const baseName = path.basename(mdPath, ".md");
  const fallbackTitle = baseName.replace(/-/g, " ");
  const title = extractTitle(md, fallbackTitle);
  const body = stripArticleTitle(md);
  const description = extractDescription(body);
  const date = formatDate(fs.statSync(mdPath).mtime);
  const mdFileDir = path.dirname(mdPath);

  const toc = [];
  const htmlContent = marked.parse(body, {
    renderer: createRenderer(mdFileDir, toc),
    gfm: true,
  });

  const html = renderPostPage({
    title,
    description,
    date,
    tocHtml: renderToc(toc),
    content: wrapTables(htmlContent).trim(),
  });

  const outPath = path.join(POSTS_DIR, baseName + ".html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log("生成：" + outPath);

  posts.push({
    title,
    description,
    date,
    link: "posts/" + encodeURIComponent(baseName) + ".html",
  });
}

/* ------------------------------ 入口 ------------------------------ */

const mdFiles = fs
  .readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => path.join(POSTS_DIR, f));

const posts = [];

if (mdFiles.length === 0) {
  console.log("posts 目录里没有 .md 文件");
} else {
  mdFiles.forEach((mdPath) => buildPost(mdPath, posts));
}

// 首页与归档按日期倒序
posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const { buildIndex } = require("./buildIndex");
buildIndex(posts, SITE);
