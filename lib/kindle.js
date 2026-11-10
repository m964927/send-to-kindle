const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * 视觉与上传页（public/index.html）保持同一套语言：
 * 纸色背景 #f7f6f3、白色圆角卡片、1px 细线、绿/黑两档按钮、无衬线字体。
 *
 * 兼容性上刻意保守——Kindle Oasis 2 的实验性浏览器很老：
 * 不用 CSS 变量、不用 flex/grid、不用 calc()，布局全靠 table；
 * 颜色全部写字面量，圆角/字重失效也只是退化，不会整页白屏。
 */
/**
 * 视觉与上传页（public/index.html）保持同一套语言：
 * 纸色背景 #f7f6f3、白色圆角卡片、1px 细线、绿/黑两档按钮、无衬线字体。
 *
 * 尺寸按 Kindle Oasis 2 的真实渲染参数设计：
 *   面板 1264 × 1680 px @300ppi，浏览器上报物理像素、DPR = 1，
 *   去掉浏览器工具栏后有效视口约 1264 × 1500。
 *   所以宽度按 1180（左右各留 42 的呼吸位）铺满，基准字号 22px
 *   （300ppi 下约 1.9mm，约等于纸书正文的观感）。
 *
 * 兼容性上刻意保守——Oasis 2 老固件的实验性浏览器是 WebKit 1.4（≈Safari 4）：
 * 不用 CSS 变量、不用 flex/grid、不用 calc()/vw，布局全靠 table；
 * 颜色全部写字面量，圆角/字重失效也只是退化，不会整页白屏。
 * 媒体查询是支持的，窄屏（手机/电脑缩窗）走 1000px 断点退回单列。
 */
const BASE_CSS = `
  * { -webkit-text-size-adjust: none; -webkit-box-sizing: border-box; box-sizing: border-box; }
  html { margin: 0; padding: 0; }
  body {
    margin: 0; padding: 0 42px 64px;
    background: #f7f6f3; color: #17181c;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
                 "Helvetica Neue", Arial, sans-serif;
    font-size: 22px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }

  /* ---------- 顶栏 ---------- */
  .top { padding: 34px 0 22px; }
  table.topbar { width: 100%; border-collapse: collapse; }
  table.topbar td { padding: 0; vertical-align: middle; }
  td.br { text-align: right; white-space: nowrap; }
  .brand { font-size: 34px; font-weight: bold; letter-spacing: .01em; }
  .logo {
    display: inline-block; width: 60px; height: 60px; line-height: 60px;
    margin-right: 18px; border-radius: 16px; text-align: center;
    background: #17181c; color: #ffffff;
    font-size: 29px; font-weight: bold; vertical-align: middle;
  }
  .count { font-size: 19px; color: #6d6e78; padding-top: 8px; }
  a.nav {
    display: inline-block; padding: 16px 24px; font-size: 22px;
    background: #ffffff; color: #2b2c33; text-decoration: none; white-space: nowrap;
    border: 1px solid #dcd9d2; border-radius: 12px;
  }

  /* ---------- 卡片 ---------- */
  .card {
    background: #ffffff; border: 1px solid #e7e5df; border-radius: 18px;
    padding: 22px 26px; margin-bottom: 18px;
  }

  /* ---------- 搜索 ---------- */
  table.searchbar { width: 100%; border-collapse: collapse; }
  table.searchbar td { padding: 0; vertical-align: middle; }
  td.sb { width: 150px; padding-left: 14px !important; }
  input[type=text] {
    width: 100%; padding: 17px 20px; font-size: 24px; font-family: inherit;
    color: #17181c; background: #fbfaf8;
    border: 1px solid #e7e5df; border-radius: 12px;
  }
  input[type=submit] {
    display: block; width: 100%; padding: 18px 0; font-size: 24px;
    font-family: inherit; color: #ffffff; background: #17181c;
    border: 1px solid #17181c; border-radius: 12px; cursor: pointer;
  }
  input[type=submit].accent { background: #1f5f4b; border-color: #1f5f4b; }

  .tip { font-size: 19px; color: #6d6e78; padding-top: 14px; }
  .tip a { color: #1f5f4b; text-decoration: none; }
  .msg { font-size: 19px; color: #a35a12; padding-top: 14px; }

  /* ---------- 多选栏 ---------- */
  table.pickbar { width: 100%; border-collapse: collapse; }
  table.pickbar td { padding: 0 0 14px; vertical-align: middle; }
  td.pl { font-size: 19px; color: #6d6e78; }
  td.pr { width: 260px; padding-left: 14px !important; }
  td.pl label { display: inline-block; padding: 10px 0; font-size: 22px; color: #2b2c33; }
  .seln { margin-left: 14px; }

  /* ---------- 列表：一行四列，按钮靠右，把 1180 的宽度用满 ---------- */
  ul.list { list-style: none; margin: 0; padding: 0; }
  ul.list.haspick { border-top: 1px solid #e7e5df; }
  li.book { border-bottom: 1px solid #e7e5df; padding: 20px 0 18px; }
  li.book.last { border-bottom: none; padding-bottom: 4px; }

  table.bk { width: 100%; border-collapse: collapse; }
  table.bk td { padding: 0; vertical-align: middle; }
  td.cbcol { width: 54px; vertical-align: top !important; }
  input.cb { width: 34px; height: 34px; margin: 10px 0 0; padding: 0; }
  td.fmt { width: 92px; vertical-align: top !important; }
  td.fmt span {
    display: block; height: 58px; line-height: 58px; text-align: center;
    border-radius: 10px; background: #f1efe9; color: #55565e;
    font-size: 15px; font-weight: bold; letter-spacing: .04em;
  }
  td.fmt span.k { background: #eaf3ef; color: #1f5f4b; }
  td.fmt span.w { background: #fdf3e7; color: #a35a12; }
  td.main { padding-left: 20px !important; }
  td.act { width: 232px; padding-left: 20px !important; text-align: right; }

  .t {
    display: block; font-size: 27px; font-weight: bold; line-height: 1.34;
    color: #17181c; text-decoration: none; word-wrap: break-word;
  }
  .m { font-size: 18px; color: #9a9ba4; padding-top: 5px; }
  li.warn .m { color: #a35a12; }

  a.dl {
    display: block; padding: 18px 0; text-align: center;
    font-size: 23px; color: #ffffff; background: #17181c;
    border: 1px solid #17181c; border-radius: 12px; text-decoration: none;
  }
  a.dl.ghost { background: #ffffff; color: #17181c; border-color: #dcd9d2; }
  /* 宽屏用行内按钮，窄屏用整行按钮 */
  a.dl.below { display: none; }

  li.empty { padding: 60px 0 66px; text-align: center; border-bottom: none; }
  li.empty .et { font-size: 28px; font-weight: bold; color: #55565e; }
  li.empty .em { font-size: 19px; color: #9a9ba4; padding-top: 10px; }

  .foot { margin-top: 24px; font-size: 19px; color: #9a9ba4; line-height: 1.9; }
  .foot a { color: #6d6e78; }
  .footbig { margin-top: 18px; }

  /* 宽屏上「下载选中」已经在上方多选栏里，底部这颗大按钮只会重复抢注意力 */
  @media (min-width: 1001px) {
    .footbig { display: none; }
  }

  /* ---------- 窄屏回退：电脑缩窗、手机、其它 Kindle（1072 宽以下走这里） ---------- */
  @media (max-width: 1000px) {
    body { padding: 0 22px 52px; font-size: 18px; }
    .top { padding: 24px 0 16px; }
    .brand { font-size: 24px; }
    .logo {
      width: 44px; height: 44px; line-height: 44px;
      margin-right: 12px; border-radius: 12px; font-size: 21px;
    }
    .count { font-size: 15px; padding-top: 5px; }
    a.nav { padding: 11px 16px; font-size: 16px; border-radius: 10px; }
    .card { padding: 16px 18px; border-radius: 14px; margin-bottom: 14px; }
    td.sb { width: 104px; padding-left: 10px !important; }
    input[type=text] { padding: 12px 14px; font-size: 18px; border-radius: 9px; }
    input[type=submit] { padding: 13px 0; font-size: 18px; border-radius: 9px; }
    .tip, .msg { font-size: 15px; padding-top: 10px; }
    table.pickbar td { padding: 0 0 10px; }
    td.pl, td.pl label { font-size: 16px; }
    td.pl label { padding: 7px 0; }
    td.pr { width: 170px; padding-left: 10px !important; }
    li.book { padding: 15px 0 14px; }
    td.cbcol { width: 36px; }
    input.cb { width: 24px; height: 24px; margin: 3px 0 0; }
    td.fmt { width: 60px; }
    td.fmt span { height: 44px; line-height: 44px; font-size: 12px; border-radius: 8px; }
    td.main { padding-left: 12px !important; }
    td.act { display: none; }
    .t { font-size: 19px; }
    .m { font-size: 13px; padding-top: 4px; }
    a.dl.inrow { display: none; }
    a.dl.below {
      display: block; margin-top: 10px; padding: 13px 0;
      font-size: 18px; border-radius: 10px;
    }
    li.empty .et { font-size: 20px; }
    li.empty .em { font-size: 15px; }
    .foot { font-size: 14px; margin-top: 16px; }
  }
`;

/**
 * Kindle 端页面：长得和上传页一致，但结构仍然朴素——
 * 不用 flex/grid、字号偏大、点击区域大，兼容 Oasis 2 的实验性浏览器。
 * 列表默认按上传时间倒序（由 store.all() 保证）。
 */
export function renderKindlePage({ items, total, q, msg }) {
  const rows = items
    .map((it, i) => {
      const last = i === items.length - 1 ? ' last' : '';
      const badge = `<td class="fmt"><span class="${it.needConvert ? 'w' : 'k'}">${esc(it.label)}</span></td>`;

      if (it.converting) {
        return `
      <li class="book${last}">
        <table class="bk"><tr>
          <td class="cbcol"></td>
          ${badge}
          <td class="main">
            <span class="t">${esc(it.title)}</span>
            <div class="m">正在转换为 Kindle 格式，请稍后刷新</div>
          </td>
        </tr></table>
      </li>`;
      }

      const box = it.selectable
        ? `<input type="checkbox" class="cb" name="id" value="${esc(it.id)}">`
        : '';

      return `
      <li class="book${it.needConvert ? ' warn' : ''}${last}">
        <table class="bk"><tr>
          <td class="cbcol">${box}</td>
          ${badge}
          <td class="main">
            <a class="t" href="${esc(it.href)}">${esc(it.title)}</a>
            <div class="m">${esc(it.size)}${it.needConvert ? ' · 该格式 Oasis 2 无法直接打开' : ''}</div>
          </td>
          <td class="act"><a class="dl inrow${it.needConvert ? ' ghost' : ''}" href="${esc(it.href)}">${it.needConvert ? '仍要下载' : '下载'}</a></td>
        </tr></table>
        <a class="dl below${it.needConvert ? ' ghost' : ''}" href="${esc(it.href)}">${it.needConvert ? '仍要下载' : '下载到 Kindle'}</a>
      </li>`;
    })
    .join('');

  const empty = `
      <li class="empty">
        <div class="et">${q ? '没有找到匹配的书' : '书架还是空的'}</div>
        <div class="em">${q ? '换个关键词试试，或点上面的「显示全部」' : '点右上角「上传新书」，把电子书传进来'}</div>
      </li>`;

  const selectableCount = items.filter((it) => it.selectable).length;

  const pickbar = selectableCount
    ? `
      <table class="pickbar">
        <tr>
          <td class="pl">
            <label><input type="checkbox" class="cb" id="pickAll"> 全选</label>
            <span class="seln" id="seln">已选 0 本</span>
          </td>
          <td class="pr"><input type="submit" value="下载选中"></td>
        </tr>
      </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kindle 书架</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <table class="topbar">
      <tr>
        <td>
          <div class="brand"><span class="logo">K</span>Kindle 书架</div>
          <div class="count">共 ${total} 本${q ? ` · 匹配 ${items.length} 本` : ' · 最近上传的在前'}</div>
        </td>
        <td class="br"><a class="nav" href="/">上传新书</a></td>
      </tr>
    </table>
  </div>

  <div class="card">
    <form method="get" action="/k">
      <table class="searchbar">
        <tr>
          <td><input type="text" name="q" value="${esc(q || '')}" placeholder="搜索书名或文件名"></td>
          <td class="sb"><input type="submit" value="搜索"></td>
        </tr>
      </table>
    </form>
    ${q ? `<div class="tip">“${esc(q)}” 的搜索结果 · <a href="/k">显示全部</a></div>` : ''}
    ${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
  </div>

  <form method="get" action="/k/download">
    <div class="card">
      ${pickbar}
      <ul class="list${selectableCount ? ' haspick' : ''}">
        ${items.length ? rows : empty}
      </ul>
    </div>
    ${selectableCount ? '<div class="footbig"><input type="submit" class="accent" value="下载选中的书"></div>' : ''}
  </form>

  <div class="foot">
    点书名或下载按钮都能直接保存到 Kindle，文件会出现在「下载」里。<br>
    <a href="/k">刷新列表</a> · <a href="/k/size">屏幕尺寸</a>
  </div>
</div>

<script>
(function () {
  var boxes = document.getElementsByName('id');
  var all = document.getElementById('pickAll');
  var seln = document.getElementById('seln');

  function count() {
    var n = 0;
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) n++;
    if (seln) seln.innerHTML = '已选 ' + n + ' 本';
    if (all) all.checked = boxes.length > 0 && n === boxes.length;
  }

  if (all) {
    all.onclick = function () {
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = all.checked;
      count();
    };
  }
  for (var i = 0; i < boxes.length; i++) boxes[i].onclick = count;
  count();
})();
</script>
</body>
</html>`;
}

/**
 * 批量下载中间页：Kindle 一次只弹一个下载，
 * 这里用隐藏 iframe 依次触发，同时给出逐个链接做降级。
 */
export function renderDownloadQueue({ books }) {
  const urls = books.map((b) => b.href);

  const rows = books
    .map(
      (b, i) => `
      <li class="book${i === books.length - 1 ? ' last' : ''}">
        <table class="bk"><tr>
          <td class="fmt"><span class="k">${esc(b.label)}</span></td>
          <td class="main">
            <a class="t" href="${esc(b.href)}">${i + 1}. ${esc(b.title)}</a>
            <div class="m">${esc(b.size)}</div>
          </td>
          <td class="act"><a class="dl inrow" href="${esc(b.href)}">下载</a></td>
        </tr></table>
      </li>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>下载 ${books.length} 本</title>
<style>${BASE_CSS}
  .status { font-size: 18px; font-weight: bold; padding: 2px 0 6px; }
  .note { font-size: 14px; color: #6d6e78; line-height: 1.7; margin: 4px 0 0; }
  iframe.dlf { position: absolute; left: -9999px; top: 0; width: 1px; height: 1px; border: 0; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <table class="topbar">
      <tr>
        <td>
          <div class="brand"><span class="logo">K</span>准备下载</div>
          <div class="count">共 ${books.length} 本，将依次下载</div>
        </td>
        <td class="br"><a class="nav" href="/k">返回书架</a></td>
      </tr>
    </table>
  </div>

  <div class="card">
    <div class="status" id="st">正在准备…</div>
    <p class="note">
      页面会自动一本一本触发下载，每本间隔几秒，请不要关掉这一页。<br>
      如果只下载了第一本，直接用下面的书名逐个点。
    </p>
  </div>

  <div class="card">
    <ul class="list">
      ${rows}
    </ul>
  </div>

  <div class="foot">
    <a href="/k">返回书架</a>
  </div>
</div>

<iframe class="dlf" id="dlf" src="about:blank"></iframe>

<script>
(function () {
  var urls = ${JSON.stringify(urls).replace(/</g, '\\u003c')};
  var st = document.getElementById('st');
  var f = document.getElementById('dlf');
  var i = 0;

  function step() {
    if (i >= urls.length) {
      st.innerHTML = '已全部触发，共 ' + urls.length + ' 本';
      return;
    }
    st.innerHTML = '正在下载第 ' + (i + 1) + ' 本，共 ' + urls.length + ' 本…';
    f.src = urls[i];
    i++;
    setTimeout(step, 2600);
  }

  setTimeout(step, 500);
})();
</script>
</body>
</html>`;
}

/**
 * 尺寸自检页：在 Kindle 上打开 /k/size，直接读出这台机器真实的上报尺寸，
 * 免得再靠猜。老固件不支持某些 API，取值全部做了兜底。
 */
export function renderSizePage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>屏幕尺寸</title>
<style>${BASE_CSS}
  table.dim { width: 100%; border-collapse: collapse; }
  table.dim td { padding: 12px 0; border-bottom: 1px solid #e7e5df; font-size: 22px; }
  table.dim td.v { text-align: right; font-weight: bold; font-family: Menlo, Consolas, monospace; }
  table.dim tr.lastrow td { border-bottom: none; }
  .ruler { height: 44px; background: #eaf3ef; border: 1px dashed #1f5f4b; border-radius: 8px; }
  .rlabel { font-size: 18px; color: #1f5f4b; padding-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <table class="topbar">
      <tr>
        <td>
          <div class="brand"><span class="logo">K</span>屏幕尺寸</div>
          <div class="count">这台设备实际报告的值</div>
        </td>
        <td class="br"><a class="nav" href="/k">返回书架</a></td>
      </tr>
    </table>
  </div>

  <div class="card">
    <table class="dim">
      <tr><td>window.innerWidth</td><td class="v" id="iw">—</td></tr>
      <tr><td>window.innerHeight</td><td class="v" id="ih">—</td></tr>
      <tr><td>document 客户区宽</td><td class="v" id="cw">—</td></tr>
      <tr><td>document 客户区高</td><td class="v" id="ch">—</td></tr>
      <tr><td>devicePixelRatio</td><td class="v" id="dpr">—</td></tr>
      <tr><td>screen.width × height</td><td class="v" id="sw">—</td></tr>
      <tr class="lastrow"><td>可用 availscreen</td><td class="v" id="aw">—</td></tr>
    </table>
  </div>

  <div class="card">
    <div class="ruler" style="width:1180px;max-width:100%"></div>
    <div class="rlabel">上面这条绿框固定 1180px 宽（超出屏幕会截断），书架页的内容区就是这个宽度</div>
  </div>

  <div class="foot">
    <a href="/k">返回书架</a>
  </div>
</div>

<script>
(function () {
  function put(id, v) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = String(v);
  }
  var d = document.documentElement;
  put('iw', window.innerWidth);
  put('ih', window.innerHeight);
  put('cw', d.clientWidth);
  put('ch', d.clientHeight);
  put('dpr', window.devicePixelRatio || 1);
  put('sw', screen.width + ' × ' + screen.height);
  put('aw', screen.availWidth + ' × ' + screen.availHeight);
})();
</script>
</body>
</html>`;
}
