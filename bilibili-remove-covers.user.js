// ==UserScript==
// @name         哔哩哔哩 - 移除首页视频封面图
// @namespace    https://www.bilibili.com/
// @version      2.9.1
// @description  首页去封面 + 知乎风单列信息流：标题=视频标题，作者=UP主，「简介」「字幕」各带徽章（点「阅读全文」/「展开字幕」就地展开），字幕按原生时间轴一条一行并标出时间点（点时间点直接跳到视频该处），点「评论」弹窗里用 iframe 看评论区，无简介 / 无字幕会提示，底部点赞 / 评论 / 收藏
// @author       you
// @match        https://www.bilibili.com/*
// @match        https://www.bilibili.com
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      aisubtitle.hdslb.com
// ==/UserScript==

(function () {
  'use strict';

  /* ===================== 配置区（改完保存刷新页面即可生效） ===================== */
  const CONFIG = {
    /** 知乎风单列布局（关掉就只保留"去封面"效果） */
    zhihuLayout: true,

    /** 单列内容区最大宽度（px），知乎是 690 左右 */
    maxWidth: 760,

    /** 简介最多预览多少个字，超出才出现「阅读全文」 */
    descMaxChars: 200,

    /** 展开后是否显示「收起」（点了可以折回去） */
    allowCollapse: true,

    /** 是否显示 播放 / 弹幕 / 时长 / 发布时间 这一行小字 */
    showMeta: true,

    /** 是否在卡片底部显示「点赞 / 评论 / 收藏」操作栏（点击会打开视频页） */
    showActions: true,

    /** 点「评论」时是在弹窗里用 iframe 看评论区（true），还是直接跳视频页（false） */
    commentModal: true,

    /** 视频没有简介时显示的占位文字 */
    fallbackDesc: '（该 UP 主没有填写简介）',

    /** 简介为空时，是否退而使用 UP 主的"视频动态"文字 */
    useDynamicAsDesc: true,

    /** 简介和动态都为空时，是否改用视频标签（如 "标签：游戏 · 实况"） */
    tagsAsFallback: true,

    /** 字幕（视频文稿）用法：
     *  'always' = 简介下面总是追加一块「字幕」（没有简介时字幕就是卡片的主要内容）
     *  'noDesc' = 只有没有简介时才抓字幕（更省流量，有简介的卡片不显示字幕块）
     *  'off'    = 完全不抓字幕（也不显示字幕提示）
     */
    subtitleMode: 'always',

    /** 字幕预览几行（字幕一条一行），剩下的点「展开字幕」接着往下排 */
    subtitlePreviewLines: 3,

    /** 字幕怎么分行：
     *  true  = 直接用 B 站原生时间轴，一条字幕一行（默认，碎但断点一定在语义边界上）
     *  false = 老的「攒够 60 字才换行」合并法（行更长，但行数少）
     */
    subtitleByTimeline: true,

    /** 是否在每条字幕前面显示时间点（可点击跳到视频对应位置） */
    showSubTime: true,

    /** 是否隐藏首页的「分区楼层卡」（直播 / 番剧那些小卡片） */
    hideFloorCards: true,

    /** 是否隐藏信息流里的直播卡（没有简介，改造成知乎样式会留下大片空白） */
    hideLiveCards: true,

    /** 是否顺带隐藏顶部站点 Banner 插画 */
    hideHeaderBanner: false,

    /** 是否阻断封面图下载（省流量，默认关） */
    blockImageLoad: false,
  };
  /* ============================================================================ */

  /* ---------- 1. 样式 ---------- */
  const css = `
/* ================= 封面图：全部不显示 ================= */
.bili-video-card picture.v-img,
.bili-video-card .bili-video-card__cover,
.bili-video-card .bili-video-card__image img,
.bili-video-card .bili-video-card__image picture,
.bili-video-card .bili-video-card__image source,
.bili-video-card .bili-video-card__image--link,
.bili-video-card .v-inline-player,
.bili-video-card .bili-watch-later--wrap,
.recommended-swipe,
.recommended-swipe-core,
.floor-card .cover-container,
.floor-card .cover-shim,
.floor-card picture.v-img,
.bili-feed4 picture.v-img:not(.banner-img):not(.logo-img):not(.icon-bg--up):not(.png-icon):not(.btn-icon-inner),
.bili-feed4 img.v-img:not(.banner-img):not(.logo-img):not(.icon-bg--up):not(.png-icon):not(.btn-icon-inner) {
  display: none !important;
}
.bili-video-card,
.bili-video-card__image,
.bili-video-card__mask {
  background-image: none !important;
}
/* 占位骨架（广告位/未加载）在知乎风下没意义，一并隐藏 */
.bili-video-card__skeleton { display: none !important; }
.bili-feed4 .bili-video-card:not(:has(.bili-video-card__info)) { display: none !important; }

${CONFIG.hideFloorCards ? `
.floor-single-card,
.floor-card,
.recommended-container_floor-aside > .container:not(.is-version8) {
  display: none !important;
}
` : ''}

${CONFIG.hideLiveCards ? `
.bili-feed4 .bili-live-card { display: none !important; }
` : ''}

${CONFIG.hideHeaderBanner ? `
.bili-header__banner .animated-banner,
.bili-header__banner .banner-img { display: none !important; }
` : ''}

${CONFIG.zhihuLayout ? `
/* ================= 知乎风：居中单列 ================= */
.bili-feed4 { background: #f6f7f8 !important; }
.feed2,
.recommended-container_floor-aside {
  display: block !important;
  width: 100% !important;
  background: transparent !important;
}
.feed2 .container.is-version8 {
  display: block !important;
  width: 100% !important;
  max-width: ${CONFIG.maxWidth}px !important;
  margin: 16px auto !important;
  padding: 0 !important;
  box-sizing: border-box !important;
  background: #fff !important;
  border-radius: 2px !important;
  overflow: hidden !important;
}
/* B站给卡片外层（.feed-card / 广告位）留了 24~40px 的大间距，单列流里拉平 */
.bili-feed4 .container.is-version8 > * {
  margin-top: 0 !important;
  margin-bottom: 0 !important;
}

/* 每张卡片 = 一条知乎式的回答 */
.bili-feed4 .bili-video-card {
  display: block !important;
  width: auto !important;
  height: auto !important;
  margin: 0 !important;
  padding: 20px 22px !important;
  background: #fff !important;
  border: none !important;
  border-bottom: 1px solid #ebebeb !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  --cover-radio: 0% !important;
}
/* 卡片外层还套了一层 .feed-card，所以每张卡都是自己父节点的 :last-child，
   不能直接用 .bili-video-card:last-child 判断，否则所有分割线都会被吃掉 */
.bili-feed4 .container.is-version8 > :last-child .bili-video-card,
.bili-feed4 .container.is-version8 > .bili-video-card:last-child { border-bottom: none !important; }
/* 不是普通投稿的卡片（番剧 / 活动 / 广告等），封面已隐藏，直接不显示 */
.bili-feed4 .bili-video-card.z-skip { display: none !important; }
.bili-feed4 .bili-video-card__wrap { display: block !important; }
.bili-feed4 .bili-video-card__info { padding: 0 !important; margin: 0 !important; display: block !important; }
.bili-feed4 .bili-video-card__info--right { display: block !important; }
.bili-feed4 .bili-video-card__info--bottom { display: none !important; }
.bili-feed4 .bili-video-card__info--no-interest { display: none !important; }

/* 标题 */
.bili-feed4 .bili-video-card__info--tit {
  display: block !important;
  margin: 0 0 8px !important;
  font-size: 18px !important;
  font-weight: 600 !important;
  line-height: 1.55 !important;
  color: #121212 !important;
  overflow: visible !important;
  white-space: normal !important;
  text-overflow: clip !important;
}
.bili-feed4 .bili-video-card__info--tit a {
  font-size: inherit !important;
  font-weight: inherit !important;
  color: inherit !important;
  display: inline !important;
  line-height: inherit !important;
}
.bili-feed4 .bili-video-card:hover .bili-video-card__info--tit a { color: #175199 !important; }

/* 正文：UP主： + 「简介」块 + 「字幕」块 */
.z-answer {
  font-size: 15px !important;
  line-height: 1.75 !important;
  color: #4a4a4a !important;
  word-break: break-word;
}
.z-answer .z-byline { margin-bottom: 2px; }
.z-answer .z-author { color: #121212 !important; font-weight: 600 !important; text-decoration: none !important; }
.z-answer .z-author:hover { color: #175199 !important; }
.z-answer .z-colon { color: #121212 !important; }
/* 「简介」「字幕」小徽章，标在每块内容前面 */
.z-answer .z-label {
  display: inline-block;
  margin-right: 6px;
  padding: 0 5px;
  border-radius: 2px;
  background: #eef2f6;
  color: #6b7a8c;
  font-size: 12px;
  line-height: 18px;
  vertical-align: 1px;
  white-space: nowrap;
  user-select: none;
}
.z-answer .z-row { margin-top: 4px; }
.z-answer .z-desc { color: #4a4a4a !important; }
.z-answer .z-desc.z-pending { color: #b9c0c8 !important; }
.z-answer .z-desc.z-tags { color: #6b7a8c !important; }
.z-answer .z-more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: #175199 !important;
  text-decoration: none !important;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  vertical-align: -2px;
  margin-left: 2px;
}
.z-answer .z-more:hover { text-decoration: underline !important; }
.z-answer .z-more .z-chev { transition: transform .18s ease; flex: none; }
.z-answer .z-more.z-open .z-chev { transform: rotate(180deg); }
.z-answer .z-desc.z-expanded { white-space: pre-wrap !important; }

/* 底部小字：播放 · 弹幕 · 时长 · 时间 */
.z-meta {
  margin-top: 10px;
  font-size: 13px;
  color: #99a0a8;
  line-height: 1.5;
}

/* 字幕（视频文稿） */
.z-answer .z-sub-slot:empty { display: none !important; }
.z-answer .z-sub {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed #e9edf1;
  font-size: 14.5px;
  line-height: 1.8;
  color: #4a4a4a;
}
.z-answer .z-sub-text { color: #4a4a4a !important; white-space: pre-line; }
/* 一条字幕一行：徽章在左，右边是「时间点 + 正文」 */
.z-answer .z-sub.z-sub-lines {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.z-answer .z-sub-lines > .z-label { flex: none; margin-top: 4px; }
.z-answer .z-sub-list {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.z-answer .z-sub-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  line-height: 1.75;
}
.z-answer .z-sub-t {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #99a0a8 !important;
  text-decoration: none !important;
  cursor: pointer;
}
.z-answer .z-sub-t:hover { color: #175199 !important; text-decoration: underline !important; }
.z-answer .z-sub-list .z-sub-more { align-self: flex-start; }

.z-answer .z-sub-c { flex: 1 1 auto; min-width: 0; color: #4a4a4a; }
/* 「暂无字幕」「该 UP 主没有填写简介」这类提示 */
.z-answer .z-desc.z-hint,
.z-answer .z-sub-text.z-hint { color: #9aa4af !important; font-style: italic; }

/* 底部操作栏：点赞 / 评论 / 收藏（知乎式） */
.z-actions {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: #8590a6;
}
.z-actions .z-act {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: inherit !important;
  text-decoration: none !important;
  cursor: pointer;
  user-select: none;
  transition: color .15s ease;
}
.z-actions .z-act:hover { color: #175199 !important; }
.z-actions .z-act svg { flex: none; }
.z-actions .z-act-num { font-variant-numeric: tabular-nums; }

/* ================= 评论弹窗（iframe 搬视频页评论区） ================= */
.z-mask {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: rgba(15, 20, 26, 0.45);
  animation: z-fade 0.14s ease-out;
}
@keyframes z-fade { from { opacity: 0; } to { opacity: 1; } }
.z-modal {
  display: flex;
  flex-direction: column;
  width: min(860px, 92vw);
  height: min(84vh, 900px);
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.28);
  overflow: hidden;
}
.z-modal-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 14px;
  border-bottom: 1px solid #eef1f4;
}
.z-modal-badge {
  flex: none;
  font-size: 12px;
  line-height: 18px;
  color: #175199;
  background: #eaf1fa;
  border-radius: 3px;
  padding: 0 6px;
}
.z-modal-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.z-modal-link {
  flex: none;
  font-size: 13px;
  color: #175199 !important;
  text-decoration: none !important;
  white-space: nowrap;
}
.z-modal-link:hover { text-decoration: underline !important; }
.z-modal-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #7b8794;
  cursor: pointer;
}
.z-modal-close:hover { background: #f1f4f7; color: #1a1a1a; }
.z-modal-body { position: relative; flex: 1 1 auto; min-height: 0; background: #fff; }
.z-modal-frame { display: block; width: 100%; height: 100%; border: 0; }
.z-modal-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #99a0a8;
  pointer-events: none;
}
@media (max-width: 640px) {
  .z-mask { padding: 0; }
  .z-modal { width: 100vw; height: 100vh; border-radius: 0; }
}
` : ''}
`;

  function injectStyle(text) {
    const style = document.createElement('style');
    style.textContent = text;
    style.setAttribute('data-bili-no-cover', '1');
    (function mount(n) {
      const root = document.head || document.documentElement;
      if (root) { root.appendChild(style); return; }
      if (n > 300) return;
      setTimeout(() => mount(n + 1), 1);
    })(0);
  }
  injectStyle(css);

  /* ---------- 2. 封面图下载拦截（可选） ---------- */
  const IMG_SELECTOR = '.bili-video-card img, .bili-video-card picture source, .floor-card img, .recommended-swipe img';

  function stripImages(root) {
    if (!CONFIG.blockImageLoad) return;
    for (const el of (root || document).querySelectorAll(IMG_SELECTOR)) {
      if (el.dataset.biliNoCover) continue;
      el.dataset.biliNoCover = '1';
      try {
        el.removeAttribute('srcset');
        el.removeAttribute('src');
        el.removeAttribute('sizes');
        if (el.tagName === 'IMG') el.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      } catch (e) { /* 忽略 */ }
    }
  }

  /* ---------- 3. 简介抓取（带本地缓存 + 队列限速） ---------- */
  const CACHE_KEY = 'zbili:desc:v4';
  const TTL = 7 * 24 * 3600 * 1000;
  const VIEW_API = 'https://api.bilibili.com/x/web-interface/view?bvid=';
  const TAG_API = 'https://api.bilibili.com/x/tag/archive/tags?bvid=';

  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { cache = {}; }

  let cacheDirty = false;
  function saveCache() {
    if (!cacheDirty) return;
    cacheDirty = false;
    try {
      const list = Object.entries(cache);
      if (list.length > 800) {
        list.sort((a, b) => b[1].t - a[1].t);
        cache = Object.fromEntries(list.slice(0, 600));
      }
      // 字幕正文体积大，单独存在 zbili:sub 里，不要写进简介缓存
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache, (k, v) => (k === 'sub' ? undefined : v)));
    } catch (e) { /* 忽略 */ }
  }
  setInterval(saveCache, 20000);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const queue = [];
  let activeCount = 0;
  let apiBlocked = false;

  function blockApi() {
    if (apiBlocked) return;
    apiBlocked = true;
    // 被风控后先把队列清空（卡片退化为占位文字），30 秒后自动恢复
    while (queue.length) queue.shift().resolve(null);
    setTimeout(() => { apiBlocked = false; pump(); }, 30000);
  }

  function pump() {
    if (apiBlocked) {
      while (queue.length) queue.shift().resolve(null);
      return;
    }
    while (activeCount < 2 && queue.length) {
      const job = queue.shift();
      activeCount++;
      fetchDesc(job.bvid)
        .then((d) => job.resolve(d))
        .catch(() => job.resolve(null))
        .finally(() => { activeCount--; pump(); });
    }
  }

  function requestDesc(bvid) {
    return new Promise((resolve) => { queue.push({ bvid, resolve }); pump(); });
  }

  const cleanText = (s) => (s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  /** 保留段落换行的清理（展开全文时用） */
  const rawClean = (s) => (s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u3000]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const oneLine = (s) => (s || '').replace(/\n+/g, ' ');

  /** 只有标点/空白（比如 "-"、"。。。"）的简介当成空的 */
  const meaningful = (t) => t.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '').length >= 2;

  async function fetchDesc(bvid) {
    const hit = cache[bvid];
    if (hit && hitsFresh(hit)) return ensureSubtitle(hit);

    await sleep(200); // 轻微错峰，降低风控概率
    const res = await fetch(VIEW_API + bvid, { credentials: 'include' });
    const json = await res.json();
    if (json.code !== 0) {
      if (json.code === -352 || json.code === -412) blockApi();
      throw new Error('api ' + json.code);
    }
    const d = json.data || {};
    const st = d.stat || {};
    let desc = rawClean(d.desc || '');
    if (!meaningful(desc) && CONFIG.useDynamicAsDesc) desc = rawClean(d.dynamic || '');
    if (!meaningful(desc)) desc = '';

    // 没有简介就拉标签，避免正文空着
    let tags = [];
    if (!desc && CONFIG.tagsAsFallback) {
      await sleep(200);
      try {
        const tj = await (await fetch(TAG_API + bvid, { credentials: 'include' })).json();
        if (tj.code === 0) tags = (tj.data || []).map((t) => t.tag_name).filter(Boolean).slice(0, 5);
        else if (tj.code === -352 || tj.code === -412) blockApi();
      } catch (e) { /* 忽略 */ }
    }

    const cid = d.cid || (d.pages && d.pages[0] && d.pages[0].cid) || 0;
    const rec = {
      d: desc,
      tg: tags,
      s: { like: st.like || 0, reply: st.reply || 0, fav: st.favorite || 0 },
      aid: d.aid || 0,
      cid,
      t: Date.now(),
    };
    cache[bvid] = rec;
    cacheDirty = true;
    return ensureSubtitle(rec);
  }

  function hitsFresh(rec) {
    return rec && typeof rec === 'object' && Date.now() - rec.t < TTL;
  }

  /* ---------- 3.6 字幕（视频文稿）抓取 ---------- */
  const SUB_KEY = 'zbili:sub:v2';
  const SUB_TTL = 3 * 24 * 3600 * 1000;
  const SUB_MAX_ENTRIES = 30;
  const PLAYER_API = 'https://api.bilibili.com/x/player/wbi/v2?';

  let subCache = {};
  try { subCache = JSON.parse(localStorage.getItem(SUB_KEY) || '{}') || {}; } catch (e) { subCache = {}; }
  // v1 存的是 60 字合并后的长文本（无时间轴），已不再使用，且体积很大，直接清掉
  try { localStorage.removeItem('zbili:sub:v1'); } catch (e) { /* 忽略 */ }
  let subDirty = false;

  function saveSubCache() {
    if (!subDirty) return;
    subDirty = false;
    try {
      const list = Object.entries(subCache);
      if (list.length > SUB_MAX_ENTRIES) {
        list.sort((a, b) => b[1].t - a[1].t);
        subCache = Object.fromEntries(list.slice(0, SUB_MAX_ENTRIES));
      }
      localStorage.setItem(SUB_KEY, JSON.stringify(subCache));
    } catch (e) { /* 忽略 */ }
  }
  setInterval(saveSubCache, 20000);

  /** 是否需要抓字幕（按 subtitleMode 配置判断） */
  function subtitleNeeded(desc) {
    if (!CONFIG.subtitleMode || CONFIG.subtitleMode === 'off') return false;
    if (CONFIG.subtitleMode === 'noDesc') return !desc;
    return true;
  }

  /** 补字幕：结果只挂在内存对象上，不进简介缓存 */
  async function ensureSubtitle(rec) {
    if (!rec || rec.sub || rec.subTried) return rec;
    rec.subTried = true;
    if (!subtitleNeeded(rec.d)) return rec;
    try {
      const lines = await fetchSubtitleLines(rec.aid, rec.cid);
      if (lines && lines.length) rec.sub = lines;
    } catch (e) { /* 拿不到就当没字幕 */ }
    return rec;
  }

  /* --- WBI 签名（B 站接口 2023 年起必须的 w_rid / wts） --- */
  const WBI_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
    33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1,
    60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

  function md5(str) {
    const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const bytes = unescape(encodeURIComponent(str));
    const n = bytes.length;
    const w = [];
    for (let i = 0; i < n; i++) w[i >> 2] = (w[i >> 2] || 0) | (bytes.charCodeAt(i) << ((i % 4) * 8));
    w[n >> 2] = (w[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
    w[(((n + 8) >> 6) + 1) * 16 - 2] = n * 8;
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const add = (x, y) => {
      const lo = (x & 0xffff) + (y & 0xffff);
      const hi = (x >> 16) + (y >> 16) + (lo >> 16);
      return (hi << 16) | (lo & 0xffff);
    };
    const rol = (x, c) => (x << c) | (x >>> (32 - c));
    for (let i = 0; i < w.length; i += 16) {
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let j = 0; j < 64; j++) {
        let f;
        let g;
        if (j < 16) { f = (b & c) | (~b & d); g = j; }
        else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
        else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * j) % 16; }
        const tmp = d;
        d = c;
        c = b;
        b = add(b, rol(add(add(a, f), add(K[j], w[i + g] || 0)), S[j]));
        a = tmp;
      }
      a0 = add(a0, a);
      b0 = add(b0, b);
      c0 = add(c0, c);
      d0 = add(d0, d);
    }
    const hex = (x) => {
      let out = '';
      for (let i = 0; i < 4; i++) out += ((x >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return out;
    };
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  let mixinKey = '';
  async function getMixinKey() {
    if (mixinKey) return mixinKey;
    const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include' })).json();
    const img = nav && nav.data && nav.data.wbi_img;
    if (!img || !img.img_url || !img.sub_url) return '';
    const raw = img.img_url.split('/').pop().split('.')[0] + img.sub_url.split('/').pop().split('.')[0];
    mixinKey = WBI_TAB.map((i) => raw[i]).join('').slice(0, 32);
    return mixinKey;
  }

  async function wbiSign(params) {
    const mixin = await getMixinKey();
    if (!mixin) return '';
    const all = Object.assign({}, params, { wts: Math.round(Date.now() / 1000) });
    const q = Object.keys(all).sort().map((k) => (
      encodeURIComponent(k) + '=' + encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))
    )).join('&');
    return q + '&w_rid=' + md5(q + mixin);
  }

  /** 字幕文件在 aisubtitle.hdslb.com，普通 fetch 会被 CORS 拦，走 GM_xmlhttpRequest */
  function gmGetText(url) {
    const gm = (typeof GM_xmlhttpRequest === 'function')
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    if (gm) {
      return new Promise((resolve, reject) => {
        gm({
          method: 'GET',
          url,
          timeout: 20000,
          onload: (r) => resolve(r.responseText || ''),
          onerror: () => reject(new Error('gm error')),
          ontimeout: () => reject(new Error('gm timeout')),
        });
      });
    }
    // 没有脚本管理器（GM）时只能退回 fetch，跨域大概率失败
    return fetch(url, { credentials: 'include' }).then((r) => r.text());
  }

  function pickSubtitle(list) {
    if (!list || !list.length) return null;
    const usable = list.filter((s) => s && s.subtitle_url);
    if (!usable.length) return null;
    const byLan = (re) => usable.find((s) => re.test(s.lan || ''));
    return byLan(/^(zh-CN|zh-Hans|zh)$/i)
      || byLan(/^ai-zh/i)
      || byLan(/^zh/i)
      || usable[0];
  }

  const SUB_MAX_LINES = 1200;   // 单视频最多保留多少条字幕（长直播文稿会非常多）
  const SUB_MAX_CHARS = 60000;

  /** 字幕 JSON -> [[开始秒数, 正文], ...]
   *  默认直接吃 B 站原生时间轴：一条字幕一行（AI 文稿一条 ~10 字，碎但断点可靠）
   *  subtitleByTimeline = false 时退回老的「攒够 60 字 / 停顿 >1.5s 才换行」合并法 */
  function subtitleToLines(body) {
    const segs = [];
    for (const seg of body || []) {
      const c = cleanText(seg && seg.content);
      if (!c) continue;
      // 过滤 "♪ 音乐 ♪" 这类占位
      if (/^[♪♫🎵🎶\s]*(音乐|music)?[♪♫🎵🎶\s]*$/i.test(c)) continue;
      segs.push({ c, from: Number(seg.from) || 0, to: Number(seg.to) || 0 });
    }

    const lines = [];
    let total = 0;
    const push = (from, c) => {
      if (!c) return false;
      // 相邻完全重复的条目（同一句被切两遍）只留一条
      const last = lines[lines.length - 1];
      if (last && last[1] === c && from - last[0] <= 1) return true;
      lines.push([Math.max(0, Math.round(from)), c]);
      total += c.length;
      return lines.length < SUB_MAX_LINES && total < SUB_MAX_CHARS;
    };

    if (CONFIG.subtitleByTimeline) {
      for (const s of segs) if (!push(s.from, s.c)) break;
      return lines;
    }

    // 老的合并法：一段一行，长的（60 字）或长停顿（1.5s）才断开
    let buf = '';
    let bufFrom = 0;
    let prevTo = null;
    for (const s of segs) {
      if (prevTo !== null && s.from - prevTo > 1.5 && buf) {
        if (!push(bufFrom, buf)) return lines;
        buf = '';
      }
      if (!buf) bufFrom = s.from;
      if (buf && /[A-Za-z0-9]$/.test(buf) && /^[A-Za-z0-9]/.test(s.c)) buf += ' ';
      buf += s.c;
      if (buf.length >= 60) {
        if (!push(bufFrom, buf)) return lines;
        buf = '';
      }
      prevTo = s.to;
    }
    if (buf) push(bufFrom, buf);
    return lines;
  }

  /** 秒 -> 00:12 / 1:02:03 */
  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const p2 = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p2(m)}:${p2(r)}` : `${p2(m)}:${p2(r)}`;
  }

  async function fetchSubtitleLines(aid, cid) {
    if (!aid || !cid) return [];
    const key = aid + '_' + cid;
    const hit = subCache[key];
    if (hit && Array.isArray(hit.l) && Date.now() - hit.t < SUB_TTL) return hit.l;

    const qs = await wbiSign({ aid, cid });
    if (!qs) return [];
    await sleep(120);
    const json = await (await fetch(PLAYER_API + qs, { credentials: 'include' })).json();
    if (json.code !== 0) {
      if (json.code === -352 || json.code === -412) blockApi();
      return [];
    }
    const sub = pickSubtitle(json.data && json.data.subtitle && json.data.subtitle.subtitles);
    if (!sub) return [];
    const url = sub.subtitle_url.startsWith('//') ? 'https:' + sub.subtitle_url : sub.subtitle_url;

    let raw = '';
    try { raw = await gmGetText(url); } catch (e) { return []; }
    let body = [];
    try { body = (JSON.parse(raw).body) || []; } catch (e) { return []; }
    const lines = subtitleToLines(body);
    if (!lines.length) return [];

    subCache[key] = { l: lines, t: Date.now() };
    subDirty = true;
    return lines;
  }

  /* ---------- 3.5 底部操作栏（点赞 / 评论 / 收藏） ---------- */
  const ICONS = {
    // Feather 图标：thumbs-up / message-circle / star
    like: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
    comment: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    fav: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  };
  const ACT_LABELS = { like: '点赞', comment: '评论', fav: '收藏' };

  /* ---- 评论弹窗：iframe 引视频页，同源所以能进去把播放器 / 简介 / 推荐都 CSS 藏掉，只留评论区 ---- */
  const MODAL_CLEAN_CSS = `
#biliMainHeader, .right-container, .fixed-sidenav-storage, .palette-button-wrap,
.bili-header, .international-header, .bili-feedback, .ad-report, .bili-dialog,
.pop-live-small-mode, #reco_list { display: none !important; }
/* 左栅里只留评论区，播放器 / 标题 / 工具栏 / 简介 / 标签 / 资源列表全部不显示 */
.left-container > *:not(#commentapp) { display: none !important; }
/* 播放器不能 display:none（B 站自己的脚本会报 undefined.style），挪到看不见的角落里就行 */
.left-container > #playerWrap {
  display: block !important;
  position: absolute !important;
  left: -10000px !important;
  top: 0 !important;
  width: 320px !important;
  height: 180px !important;
  overflow: hidden !important;
  pointer-events: none !important;
}
/* 小窗：播放器一旦“滚出视野”就变成 fixed 贴在弹窗右下角，这里直接摁掉 */
.bpx-player-container, .bpx-player-mini-warp, .bpx-player-context-area,
.bpx-player-dm-mask-wrap, .bpx-player-row-dm-wrap, .bpx-player-bas-dm-wrap,
.bpx-player-subtitle-wrap, .bpx-player-new-dialogue-area, .bpx-player-adv-dm-wrap,
.bas-danmaku, .bili-danmaku-x-dm-rotate, .bpx-player-mini-state { display: none !important; }
/* 视频页是定宽 1080 的，塞进弹窗要拆成自适应；#mirror-vdcon 是 flex，左栅要占满 */
.left-container, #mirror-vdcon, .video-container-v1, #app.app-v1 {
  width: auto !important; max-width: none !important; min-width: 0 !important;
  float: none !important; padding: 0 !important; margin: 0 !important; left: auto !important;
}
.left-container { flex: 1 1 100% !important; width: 100% !important; }
#commentapp { margin: 0 !important; padding: 6px 14px 24px !important; box-sizing: border-box !important; }
body { background: #fff !important; overflow-x: hidden !important; }
`;

  let modal = null;

  function closeCommentModal() {
    if (!modal) return;
    if (modal.timer) clearInterval(modal.timer);
    document.removeEventListener('keydown', modal.onKey, true);
    document.documentElement.style.overflow = modal.prevOverflow;
    modal.mask.remove();
    modal = null;
  }

  function openCommentModal(bvid, title) {
    if (!CONFIG.commentModal || !bvid) return;
    if (modal) closeCommentModal();

    const mask = document.createElement('div');
    mask.className = 'z-mask';
    mask.addEventListener('mousedown', (ev) => { if (ev.target === mask) closeCommentModal(); });

    const box = document.createElement('div');
    box.className = 'z-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '评论');

    const head = document.createElement('div');
    head.className = 'z-modal-head';
    const badge = document.createElement('span');
    badge.className = 'z-modal-badge';
    badge.textContent = '评论';
    const ttl = document.createElement('div');
    ttl.className = 'z-modal-title';
    ttl.textContent = title || '视频评论';
    ttl.title = ttl.textContent;
    const open = document.createElement('a');
    open.className = 'z-modal-link';
    open.href = 'https://www.bilibili.com/video/' + bvid + '/';
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = '在B站打开';
    open.addEventListener('click', (ev) => ev.stopPropagation());
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'z-modal-close';
    close.setAttribute('aria-label', '关闭');
    close.title = '关闭（Esc）';
    close.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"'
      + ' stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeCommentModal();
    });
    head.append(badge, ttl, open, close);

    const body = document.createElement('div');
    body.className = 'z-modal-body';
    const loading = document.createElement('div');
    loading.className = 'z-modal-loading';
    loading.textContent = '评论区加载中…';

    const frame = document.createElement('iframe');
    frame.className = 'z-modal-frame';
    frame.title = '视频评论区';
    frame.src = 'https://www.bilibili.com/video/' + bvid + '/';

    body.append(frame, loading);
    box.append(head, body);
    mask.appendChild(box);

    const onKey = (ev) => {
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        ev.stopPropagation();
        closeCommentModal();
      }
    };

    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    (document.body || document.documentElement).appendChild(mask);
    try { close.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }

    modal = { mask, frame, timer: null, onKey, prevOverflow };

    // iframe 同源，可以进去注样式：藏播放器/简介/推荐，只留评论区
    let passes = 0;
    const startedAt = Date.now();
    const prep = () => {
      let d = null;
      try { d = frame.contentDocument; } catch (e) { d = null; }
      if (!d || !d.documentElement) return false;
      if (!d.getElementById('z-modal-clean')) {
        const st = d.createElement('style');
        st.id = 'z-modal-clean';
        st.textContent = MODAL_CLEAN_CSS;
        (d.head || d.documentElement).appendChild(st);
      }
      // 别让弹窗里的播放器跑起来（占流量 / 出声 / 变成右下角小窗）
      d.querySelectorAll('video').forEach((v) => {
        try { v.pause(); v.muted = true; } catch (e) { /* 忽略 */ }
      });
      const app = d.querySelector('#commentapp') || d.querySelector('bili-comments');
      if (!app) return false;
      // 评论列表是 shadow DOM 异步渲染的，看到内容才叫真的好了
      const bc = d.querySelector('bili-comments');
      const loaded = !!bc && !!bc.shadowRoot && bc.shadowRoot.childElementCount > 0;
      const ready = loaded || (Date.now() - startedAt > 5000 && app.childElementCount > 0);
      if (!ready) return false;
      // 评论出来了，播放器就没用了：整个删掉，视频流也一起断（不然每次都要拖几十 MB）
      // 注意只能在评论渲染完之后删，删早了 B 站自己的页面初始化会挂，评论区也跟着不出来
      const pw = d.querySelector('#playerWrap');
      if (pw) pw.remove();
      if (passes < 3) {
        d.documentElement.scrollTop = 0;
        if (d.body) d.body.scrollTop = 0;
      }
      passes++;
      if (loading.parentNode) loading.remove();
      return passes >= 3;
    };
    prep();
    // 评论区异步渲染：注完样式后再盯一会儿，顺便反复暂停播放器
    modal.timer = setInterval(() => {
      if (!modal) return;
      let done = false;
      try { done = prep(); } catch (e) { done = false; }
      if (done && modal && modal.timer) { clearInterval(modal.timer); modal.timer = null; }
    }, 500);
    // 最多盯 20 秒，别一直轮询
    setTimeout(() => {
      if (!modal) return;
      if (modal.timer) { clearInterval(modal.timer); modal.timer = null; }
      if (loading.parentNode) loading.textContent = '评论区没加载出来？点右上角「在B站打开」';
    }, 20000);
  }

  const fmtNum = (n) => {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  };

  function buildActions(url, bvid, title) {
    const acts = document.createElement('div');
    acts.className = 'z-actions';
    acts.style.display = 'none'; // 拿到统计数据后再显示，避免占位跳动
    Object.keys(ICONS).forEach((key) => {
      const a = document.createElement('a');
      a.className = 'z-act z-act-' + key;
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = ACT_LABELS[key] + '（打开视频页）';
      a.setAttribute('aria-label', ACT_LABELS[key]);
      a.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
        + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="' + ICONS[key] + '"/></svg>'
        + '<span class="z-act-num">—</span>';
      if (key === 'comment' && CONFIG.commentModal && bvid) {
        // 评论不跳页，就地开弹窗看
        a.removeAttribute('target');
        a.setAttribute('role', 'button');
        a.title = '在弹窗里看评论区';
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openCommentModal(bvid, title);
        });
      }
      acts.appendChild(a);
    });
    return acts;
  }

  function fillActions(card, stat) {
    const acts = card.querySelector('.z-actions');
    if (!acts) return;
    if (!stat) { acts.style.display = 'none'; return; }
    const put = (key, val) => {
      const el = acts.querySelector('.z-act-' + key + ' .z-act-num');
      if (el) el.textContent = fmtNum(val);
    };
    put('like', stat.like);
    put('comment', stat.reply);
    put('fav', stat.fav);
    acts.style.display = '';
  }

  /* ---------- 4. 把卡片改造成「标题 + UP主：简介」 ---------- */
  const clip = (text, n) => {
    const t = oneLine(text).replace(/\s{2,}/g, ' ').trim();
    return t.length > n ? t.slice(0, n).trimEnd() + '…' : t;
  };

  function setMoreLabel(moreEl, label) {
    const t = moreEl.querySelector('.z-more-text');
    if (t) t.textContent = label;
    else moreEl.textContent = label;
  }

  const CHEV = '<svg class="z-chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
    + '<path d="M4 6.5L8 10.5L12 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---- 字幕块：一段一行，点「展开字幕」就地接着往下排 ---- */
  function makeSubMore() {
    const more = document.createElement('span');
    more.className = 'z-more z-sub-more';
    more.setAttribute('role', 'button');
    more.tabIndex = 0;
    more.innerHTML = '<span class="z-more-text">展开字幕</span>' + CHEV;
    return more;
  }

  function makeLabel(text) {
    const label = document.createElement('span');
    label.className = 'z-label';
    label.textContent = text;
    return label;
  }

  function setLabel(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  /** 时间点：显示 00:12，点击直接跳到视频的那一秒 */
  function subTimeLink(sec, bvid) {
    const at = Math.max(0, Math.floor(Number(sec) || 0));
    const a = document.createElement('a');
    a.className = 'z-sub-t';
    a.textContent = fmtTime(at);
    a.title = '从 ' + fmtTime(at) + ' 开始播放';
    if (bvid) a.href = 'https://www.bilibili.com/video/' + bvid + '?t=' + at;
    a.target = '_blank';
    a.rel = 'noopener';
    // 卡片自己也是链接，别把点击冒泡上去
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  }

  function makeSubLine(item, bvid) {
    const line = document.createElement('div');
    line.className = 'z-sub-line';
    if (CONFIG.showSubTime) line.appendChild(subTimeLink(item[0], bvid));
    const c = document.createElement('span');
    c.className = 'z-sub-c';
    c.textContent = String(item[1] || '');
    line.appendChild(c);
    return line;
  }

  /** 字幕块：B 站原生时间轴一条一行，先露前 N 条，点「展开字幕」把剩下的接着往下排 */
  function buildSubBlock(slot, lines, bvid) {
    if (!slot) return;
    slot.textContent = '';
    const items = (Array.isArray(lines) ? lines : [])
      .map((it) => (Array.isArray(it) ? [Number(it[0]) || 0, String(it[1] || '').trim()] : null))
      .filter((it) => it && it[1]);
    if (!items.length) return;

    const wrap = document.createElement('div');
    wrap.className = 'z-sub z-sub-lines';
    wrap.appendChild(makeLabel('字幕'));

    const list = document.createElement('div');
    list.className = 'z-sub-list';
    wrap.appendChild(list);

    const maxLines = CONFIG.subtitlePreviewLines > 0 ? CONFIG.subtitlePreviewLines : items.length;
    const head = items.slice(0, maxLines);
    const rest = items.slice(maxLines);
    head.forEach((it) => list.appendChild(makeSubLine(it, bvid)));

    if (rest.length) {
      const more = makeSubMore();
      more.title = '展开全部 ' + items.length + ' 条字幕';
      list.appendChild(more);

      let restNodes = null;
      const toggle = (ev) => {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        if (more.classList.contains('z-open')) {
          if (restNodes) restNodes.forEach((n) => n.remove());
          more.classList.remove('z-open');
          setMoreLabel(more, '展开字幕');
          return;
        }
        // 展开：把剩下的行接在后面，不另开面板、不滚区
        if (!restNodes) restNodes = rest.map((it) => makeSubLine(it, bvid));
        const frag = document.createDocumentFragment();
        restNodes.forEach((n) => frag.appendChild(n));
        list.insertBefore(frag, more);
        more.classList.add('z-open');
        if (CONFIG.allowCollapse) setMoreLabel(more, '收起');
        else more.style.display = 'none';
      };
      more.addEventListener('click', toggle);
      more.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') toggle(ev);
      });
    }
    slot.appendChild(wrap);
  }

  /** 没字幕：也给一个提示，别让用户以为脚本没生效 */
  function buildSubEmpty(slot) {
    if (!slot) return;
    slot.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'z-sub z-row';
    wrap.appendChild(makeLabel('字幕'));

    const hint = document.createElement('span');
    hint.className = 'z-sub-text z-hint';
    hint.textContent = '暂无字幕';
    hint.title = '该视频没有文稿字幕；AI 字幕需要登录 B 站后才会返回';
    wrap.appendChild(hint);
    slot.appendChild(wrap);
  }

  function bindExpand(descEl, moreEl, fullText) {
    const toggle = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const expanded = descEl.classList.contains('z-expanded');
      if (expanded) {
        descEl.textContent = descEl.dataset.preview || '';
        descEl.classList.remove('z-expanded');
        moreEl.classList.remove('z-open');
        setMoreLabel(moreEl, '阅读全文');
      } else {
        descEl.textContent = fullText;
        descEl.classList.add('z-expanded');
        moreEl.classList.add('z-open');
        setMoreLabel(moreEl, CONFIG.allowCollapse ? '收起' : '');
        if (!CONFIG.allowCollapse) moreEl.style.display = 'none';
      }
    };
    moreEl.addEventListener('click', toggle);
    moreEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); }
    });
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          loadDesc(en.target);
        });
      }, { rootMargin: '600px 0px' })
    : null;

  function loadDesc(card) {
    const bvid = card.dataset.zbBvid;
    const box = card.querySelector('.z-answer');
    if (!bvid || !box) return;
    const descEl = box.querySelector('.z-desc');
    const moreEl = box.querySelector('.z-more');
    const slot = box.querySelector('.z-sub-slot');
    if (!descEl) return;

    requestDesc(bvid).then((rec) => {
      if (!descEl.isConnected) return;
      descEl.classList.remove('z-pending');
      const descLabel = box.querySelector('.z-desc-label');

      // 接口挂了 / 被风控：别误报「该 UP 主没有填写简介」
      if (!rec || typeof rec !== 'object') {
        setLabel(descLabel, '简介');
        descEl.textContent = '简介加载失败，稍后刷新重试';
        descEl.classList.add('z-hint');
        if (moreEl) moreEl.style.display = 'none';
        fillActions(card, null);
        return;
      }

      const full = rec.d || '';
      const tags = rec.tg || [];
      const sub = Array.isArray(rec.sub) ? rec.sub : [];

      if (full) {
        setLabel(descLabel, '简介');
        const preview = clip(full, CONFIG.descMaxChars);
        descEl.textContent = preview;
        descEl.dataset.preview = preview;

        // 已经能完整显示 → 不出现「阅读全文」
        if (oneLine(full).length > CONFIG.descMaxChars) {
          if (moreEl) {
            moreEl.style.display = '';
            setMoreLabel(moreEl, '阅读全文');
            bindExpand(descEl, moreEl, full);
          }
        } else if (moreEl) {
          moreEl.style.display = 'none';
        }
      } else if (tags.length) {
        setLabel(descLabel, '标签');
        descEl.textContent = tags.join(' · ');
        descEl.classList.add('z-tags');
        if (moreEl) moreEl.style.display = 'none';
      } else {
        // 简介 / 动态 / 标签都没有 → 明确告诉用户
        setLabel(descLabel, '简介');
        descEl.textContent = CONFIG.fallbackDesc;
        descEl.classList.add('z-hint');
        if (moreEl) moreEl.style.display = 'none';
      }

      // 字幕：抓到就显示预览 +「展开字幕」，抓不到也给一个提示
      if (subtitleNeeded(full)) {
        if (sub.length) buildSubBlock(slot, sub, bvid);
        else buildSubEmpty(slot);
      }

      fillActions(card, rec.s);
    });
  }

  function enhance(card) {
    if (!CONFIG.zhihuLayout) return;
    if (card.dataset.zbState === 'ok' && card.querySelector('.z-answer')) return;

    const info = card.querySelector('.bili-video-card__info');
    const tit = info && info.querySelector('.bili-video-card__info--tit');
    if (!tit) return;

    const link = tit.querySelector('a');
    const href = link ? link.href : '';
    const m = href.match(/\/video\/(BV[0-9A-Za-z]{10})/);
    if (!m) {
      // 番剧 / 活动 / 广告卡：封面已经隐藏，留着只会剩一块空白，直接跳过
      card.classList.add('z-skip');
      return;
    }
    const bvid = m[1];
    card.classList.remove('z-skip');

    const authorEl = card.querySelector('.bili-video-card__info--author');
    const ownerEl = card.querySelector('.bili-video-card__info--owner');
    const author = (authorEl ? authorEl.textContent : (ownerEl ? ownerEl.textContent : '')).replace(/·.*$/, '').trim();
    const date = (card.querySelector('.bili-video-card__info--date') || {}).textContent || '';
    const statTexts = [...card.querySelectorAll('.bili-video-card__stats--text')].map((e) => e.textContent.trim());
    const dur = (card.querySelector('.bili-video-card__stats__duration') || {}).textContent || '';

    const box = document.createElement('div');
    box.className = 'z-answer';

    // 第一行：UP主：
    const byline = document.createElement('div');
    byline.className = 'z-byline';

    const authorA = document.createElement('a');
    authorA.className = 'z-author';
    authorA.textContent = author;
    if (ownerEl && ownerEl.href) { authorA.href = ownerEl.href; authorA.target = '_blank'; }
    byline.appendChild(authorA);

    const colon = document.createElement('span');
    colon.className = 'z-colon';
    colon.textContent = '：';
    byline.appendChild(colon);
    box.appendChild(byline);

    // 第二块：简介（和字幕一样带一个小徽章）
    const descRow = document.createElement('div');
    descRow.className = 'z-row z-desc-row';

    const descLabel = document.createElement('span');
    descLabel.className = 'z-label z-desc-label';
    descLabel.textContent = '简介';
    descRow.appendChild(descLabel);

    const descEl = document.createElement('span');
    descEl.className = 'z-desc z-pending';
    descEl.textContent = '简介加载中…';
    descRow.appendChild(descEl);

    const moreEl = document.createElement('span');
    moreEl.className = 'z-more';
    moreEl.setAttribute('role', 'button');
    moreEl.tabIndex = 0;
    moreEl.style.display = 'none'; // 默认不显示，只有简介被截断时才出现
    moreEl.innerHTML = '<span class="z-more-text">阅读全文</span>' + CHEV;
    descRow.appendChild(moreEl);
    box.appendChild(descRow);

    // 字幕块的容器（跟在简介后面、meta 前面）
    const slot = document.createElement('div');
    slot.className = 'z-sub-slot';
    box.appendChild(slot);

    if (CONFIG.showMeta) {
      const bits = [];
      if (statTexts[0]) bits.push(statTexts[0] + ' 播放');
      if (statTexts[1]) bits.push(statTexts[1] + ' 弹幕');
      if (dur) bits.push(dur);
      const d = cleanText(date).replace(/^·\s*/, '');
      if (d) bits.push(d);
      if (bits.length) {
        const meta = document.createElement('div');
        meta.className = 'z-meta';
        meta.textContent = bits.join(' · ');
        box.appendChild(meta);
      }
    }

    tit.insertAdjacentElement('afterend', box);
    if (CONFIG.showActions) box.appendChild(buildActions(link ? link.href : href, bvid, tit.textContent));
    card.dataset.zbBvid = bvid;
    card.dataset.zbState = 'ok';

    if (io) io.observe(card);
    else loadDesc(card);
  }

  function scan() {
    stripImages(document);
    if (CONFIG.zhihuLayout) document.querySelectorAll('.bili-video-card').forEach(enhance);
  }

  /* ---------- 5. 动态加载 / 无限滚动 ---------- */
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(); });
  }

  function init() {
    if (!document.documentElement) { setTimeout(init, 10); return; }
    scan();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
