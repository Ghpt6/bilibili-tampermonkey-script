// ==UserScript==
// @name         哔哩哔哩 - 移除首页视频封面图
// @namespace    https://www.bilibili.com/
// @version      2.14.0
// @description  首页去封面 + 知乎风单列信息流：标题=视频标题，作者=UP主，「简介」「字幕」各带徽章（点「阅读全文」/「展开字幕」就地展开，字幕展开后右下角悬浮「收起字幕」，不用滚到末尾），字幕按原生时间轴一条一行并标出时间点（点时间点直接跳到视频该处），点「评论」弹窗里直接渲染评论（热门/最新、点赞数、表情、子回复），无简介 / 无字幕会提示，底部「点赞」点了就地给视频点赞（再点取消）/「评论」弹窗看评论 /「收藏」只显示数字不可点
// @author       you
// @match        https://www.bilibili.com/*
// @match        https://www.bilibili.com
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      aisubtitle.hdslb.com
// ==/UserScript==

/* ============================================================================
 * 结构（一个 IIFE，从上往下读就是一条完整链路）
 *
 *   1. CONFIG   所有开关，改完保存刷新页面即可生效
 *   2. CSS      一张 <style data-bili-no-cover>，样式全在这里
 *   3. 工具     el / cleanText / clip / fmtNum / fmtTime / escapeHtml / fixUrl
 *   4. 缓存     localStorage：简介 zbili:desc:v4、字幕 zbili:sub:v2
 *   5. 网络     fetchJSON + 队列限速（并发 2）+ 风控退避（-352/-412 停 30s）+ 点赞提交
 *   6. 简介     view 接口 → 简介 / 标签 / 播放·评论·收藏数
 *   7. 字幕     WBI 签名 → player/wbi/v2 → 字幕 JSON → [[秒, 正文], ...]
 *             展开后内联「收起」滚出视口时，右下角浮一个「收起字幕」（只服务最后展开的那块）
 *   8. 卡片     标题 +「UP主：」+「简介」+「字幕」+ meta + 操作栏（点赞就地提交）
 *   9. 评论     /x/v2/reply 分页渲染 + 子回复按需加载
 *  10. 启动     IntersectionObserver 懒加载 + MutationObserver 增量扫描
 * ========================================================================== */

(function () {
  'use strict';

  /* ===================== 1. 配置 ===================== */
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

    /** 是否在卡片底部显示「点赞 / 评论 / 收藏」操作栏 */
    showActions: true,

    /** 点「评论」时是在弹窗里看评论区（true），还是直接跳视频页（false） */
    commentModal: true,

    /** 点「点赞」时直接调接口点赞（再点取消），false 则恢复成跳视频页 */
    likeInPlace: true,

    /** 「收藏」是否可点（点了会跳视频页）；false = 只显示收藏数、不可点，避免误导 */
    favClickable: false,

    /** 评论弹窗默认排序：'hot' 热门（按点赞）/ 'new' 最新（按时间） */
    commentSort: 'hot',

    /** 视频没有简介时显示的占位文字 */
    fallbackDesc: '（该 UP 主没有填写简介）',

    /** 简介为空时，是否退而使用 UP 主的"视频动态"文字 */
    useDynamicAsDesc: true,

    /** 简介和动态都为空时，是否改用视频标签（如 "游戏 · 实况"） */
    tagsAsFallback: true,

    /** 字幕（视频文稿）用法：
     *  'always' = 简介下面总是追加一块「字幕」（没有简介时字幕就是主要内容）
     *  'noDesc' = 只有没有简介时才抓字幕（更省流量）
     *  'off'    = 完全不抓字幕（也不显示字幕提示）
     */
    subtitleMode: 'always',

    /** 字幕预览几行，剩下的点「展开字幕」接着往下排 */
    subtitlePreviewLines: 3,

    /** 字幕怎么分行：
     *  true  = 直接用 B 站原生时间轴，一条字幕一行（碎但断点一定在语义边界上）
     *  false = 老的「攒够 60 字才换行」合并法（行更长，但行数少）
     */
    subtitleByTimeline: true,

    /** 是否在每条字幕前面显示时间点（可点击跳到视频对应位置） */
    showSubTime: true,

    /** 是否隐藏首页的「分区楼层卡」（直播 / 番剧那些小卡片） */
    hideFloorCards: true,

    /** 是否隐藏信息流里的直播卡（没有简介，改造后只剩大片空白） */
    hideLiveCards: true,

    /** 是否顺带隐藏顶部站点 Banner 插画 */
    hideHeaderBanner: false,

    /** 是否阻断封面图下载（省流量，默认关） */
    blockImageLoad: false,
  };

  /* ===================== 2. CSS ===================== */
  const css = `
/* ===== 封面：全部不显示 ===== */
.bili-video-card picture.v-img,
.bili-video-card .bili-video-card__cover,
.bili-video-card .bili-video-card__image img,
.bili-video-card .bili-video-card__image picture,
.bili-video-card .bili-video-card__image source,
.bili-video-card .bili-video-card__image--link,
.bili-video-card .v-inline-player,
.bili-video-card .bili-watch-later--wrap,
.recommended-swipe, .recommended-swipe-core,
.floor-card .cover-container, .floor-card .cover-shim, .floor-card picture.v-img,
.bili-feed4 picture.v-img:not(.banner-img):not(.logo-img):not(.icon-bg--up):not(.png-icon):not(.btn-icon-inner),
.bili-feed4 img.v-img:not(.banner-img):not(.logo-img):not(.icon-bg--up):not(.png-icon):not(.btn-icon-inner) { display: none !important; }
.bili-video-card, .bili-video-card__image, .bili-video-card__mask { background-image: none !important; }
/* 占位骨架（广告位 / 未加载）在知乎风下没意义 */
.bili-video-card__skeleton { display: none !important; }
.bili-feed4 .bili-video-card:not(:has(.bili-video-card__info)) { display: none !important; }
${CONFIG.hideFloorCards ? `.floor-single-card, .floor-card,
.recommended-container_floor-aside > .container:not(.is-version8) { display: none !important; }` : ''}
${CONFIG.hideLiveCards ? `.bili-feed4 .bili-live-card { display: none !important; }` : ''}
${CONFIG.hideHeaderBanner ? `.bili-header__banner .animated-banner, .bili-header__banner .banner-img { display: none !important; }` : ''}
${CONFIG.zhihuLayout ? `
/* ===== 知乎风：居中单列 ===== */
.bili-feed4 { background: #f6f7f8 !important; }
.feed2, .recommended-container_floor-aside { display: block !important; width: 100% !important; background: transparent !important; }
.feed2 .container.is-version8 {
  display: block !important; width: 100% !important; max-width: ${CONFIG.maxWidth}px !important;
  margin: 16px auto !important; padding: 0 !important; box-sizing: border-box !important;
  background: #fff !important; border-radius: 2px !important; overflow: hidden !important;
}
/* B站给卡片外层（.feed-card / 广告位）留了 24~40px 大间距，单列流里拉平 */
.bili-feed4 .container.is-version8 > * { margin-top: 0 !important; margin-bottom: 0 !important; }

/* 每张卡片 = 一条知乎回答 */
.bili-feed4 .bili-video-card {
  display: block !important; width: auto !important; height: auto !important; margin: 0 !important;
  padding: 20px 22px !important; background: #fff !important; border: none !important;
  border-bottom: 1px solid #ebebeb !important; border-radius: 0 !important;
  box-shadow: none !important; --cover-radio: 0% !important;
}
/* 卡片外面还套了一层 .feed-card，每张卡都是自己父节点的 :last-child，
   不能直接用 .bili-video-card:last-child 判断，否则所有分割线都会被吃掉 */
.bili-feed4 .container.is-version8 > :last-child .bili-video-card,
.bili-feed4 .container.is-version8 > .bili-video-card:last-child { border-bottom: none !important; }
/* 不是普通投稿的卡片（番剧 / 活动 / 广告等），封面已隐藏，直接不显示 */
.bili-feed4 .bili-video-card.z-skip { display: none !important; }
.bili-feed4 .bili-video-card__wrap { display: block !important; }
.bili-feed4 .bili-video-card__info { display: block !important; padding: 0 !important; margin: 0 !important; }
.bili-feed4 .bili-video-card__info--right { display: block !important; }
.bili-feed4 .bili-video-card__info--bottom { display: none !important; }
.bili-feed4 .bili-video-card__info--no-interest { display: none !important; }

/* 标题 */
.bili-feed4 .bili-video-card__info--tit {
  display: block !important; margin: 0 0 8px !important; font-size: 18px !important;
  font-weight: 600 !important; line-height: 1.55 !important; color: #121212 !important;
  overflow: visible !important; white-space: normal !important; text-overflow: clip !important;
}
.bili-feed4 .bili-video-card__info--tit a {
  display: inline !important; font-size: inherit !important; font-weight: inherit !important;
  color: inherit !important; line-height: inherit !important;
}
.bili-feed4 .bili-video-card:hover .bili-video-card__info--tit a { color: #175199 !important; }

/* ===== 卡片正文：UP主： + 「简介」 + 「字幕」 ===== */
.z-answer { font-size: 15px !important; line-height: 1.75 !important; color: #4a4a4a !important; word-break: break-word; }
.z-answer .z-byline { margin-bottom: 2px; }
.z-answer .z-author { color: #121212 !important; font-weight: 600 !important; text-decoration: none !important; }
.z-answer .z-author:hover { color: #175199 !important; }
.z-answer .z-colon { color: #121212 !important; }
/* 「简介」「字幕」小徽章 */
.z-answer .z-label {
  display: inline-block; margin-right: 6px; padding: 0 5px; border-radius: 2px;
  background: #eef2f6; color: #6b7a8c; font-size: 12px; line-height: 18px;
  vertical-align: 1px; white-space: nowrap; user-select: none;
}
.z-answer .z-row { margin-top: 4px; }
.z-answer .z-desc { color: #4a4a4a !important; }
.z-answer .z-desc.z-pending { color: #b9c0c8 !important; }
.z-answer .z-desc.z-tags { color: #6b7a8c !important; }
.z-answer .z-desc.z-expanded { white-space: pre-wrap !important; }
/* 「阅读全文」/「展开字幕」 */
.z-answer .z-more {
  display: inline-flex; align-items: center; gap: 2px; margin-left: 2px;
  color: #175199 !important; text-decoration: none !important; white-space: nowrap;
  cursor: pointer; user-select: none; vertical-align: -2px;
}
.z-answer .z-more:hover { text-decoration: underline !important; }
.z-answer .z-more .z-chev { flex: none; transition: transform .18s ease; }
.z-answer .z-more.z-open .z-chev { transform: rotate(180deg); }
/* 「暂无字幕」「该 UP 主没有填写简介」这类提示 */
.z-answer .z-desc.z-hint, .z-answer .z-sub-text.z-hint { color: #9aa4af !important; font-style: italic; }

/* 播放 · 弹幕 · 时长 · 时间 */
.z-meta { margin-top: 10px; font-size: 13px; line-height: 1.5; color: #99a0a8; }

/* ===== 字幕：一条一行，行首时间点 ===== */
.z-answer .z-sub-slot:empty { display: none !important; }
.z-answer .z-sub {
  margin-top: 8px; padding-top: 10px; border-top: 1px dashed #e9edf1;
  font-size: 14.5px; line-height: 1.8; color: #4a4a4a;
}
.z-answer .z-sub-text { color: #4a4a4a !important; white-space: pre-line; }
.z-answer .z-sub.z-sub-lines { display: flex; align-items: flex-start; gap: 8px; }
.z-answer .z-sub-lines > .z-label { flex: none; margin-top: 4px; }
.z-answer .z-sub-list { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.z-answer .z-sub-line { display: flex; align-items: baseline; gap: 8px; line-height: 1.75; }
.z-answer .z-sub-t {
  flex: none; font-size: 12px; font-variant-numeric: tabular-nums;
  color: #99a0a8 !important; text-decoration: none !important; cursor: pointer;
}
.z-answer .z-sub-t:hover { color: #175199 !important; text-decoration: underline !important; }
.z-answer .z-sub-c { flex: 1 1 auto; min-width: 0; color: #4a4a4a; }
.z-answer .z-sub-list .z-sub-more { align-self: flex-start; }
/* 展开后右下角悬浮的「收起字幕」：字幕太长时不用滚到末尾去点内联的那个 */
.z-sub-float {
  position: fixed; right: 22px; bottom: 22px; z-index: 2147482900;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 9px 15px 9px 16px; border-radius: 999px;
  background: rgba(26, 29, 33, .92); color: #fff !important;
  font-size: 13px; line-height: 1; white-space: nowrap;
  cursor: pointer; user-select: none;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .24);
  opacity: 0; transform: translateY(10px); visibility: hidden; pointer-events: none;
  transition: opacity .16s ease, transform .16s ease, visibility .16s ease;
}
.z-sub-float.z-on { opacity: 1; transform: none; visibility: visible; pointer-events: auto; }
.z-sub-float:hover { background: rgba(23, 81, 153, .96); }
.z-sub-float .z-chev { transform: rotate(180deg); }

/* ===== 操作栏：点赞 / 评论 / 收藏 ===== */
.z-actions { display: flex; align-items: center; gap: 24px; margin-top: 12px; font-size: 13px; line-height: 1.5; color: #8590a6; }
.z-actions .z-act {
  display: inline-flex; align-items: center; gap: 5px; color: inherit !important;
  text-decoration: none !important; cursor: pointer; user-select: none; transition: color .15s ease;
}
.z-actions .z-act:hover { color: #175199 !important; }
.z-actions .z-act svg { flex: none; }
.z-actions .z-act-num { font-variant-numeric: tabular-nums; }
/* 已经点过赞：图标变红 + 实心 */
.z-actions .z-act.z-liked { color: #f56c6c !important; }
.z-actions .z-act.z-liked svg path { fill: currentColor; }
/* 收藏：只当数字看，不可点、不变蓝、不显示手型 */
.z-actions .z-act.z-static { cursor: default; }
.z-actions .z-act.z-static:hover { color: inherit !important; }
.z-act.z-busy { opacity: .55; pointer-events: none; }

/* 轻提示：点赞成功 / 未登录 / 风控 */
.z-toast {
  position: fixed; left: 50%; bottom: 46px; transform: translateX(-50%); z-index: 2147483600;
  max-width: 80vw; padding: 8px 14px; border-radius: 6px;
  background: rgba(26, 29, 33, .9); color: #fff !important;
  font-size: 13px; line-height: 1.5; text-align: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .22); pointer-events: none;
  animation: z-toast-in .16s ease-out;
}
@keyframes z-toast-in {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

/* ===== 评论弹窗 ===== */
.z-mask {
  position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center;
  justify-content: center; padding: 4vh 4vw; background: rgba(15, 20, 26, .45);
  animation: z-fade .14s ease-out;
}
@keyframes z-fade { from { opacity: 0; } to { opacity: 1; } }
.z-modal {
  display: flex; flex-direction: column; width: min(860px, 92vw); height: min(84vh, 900px);
  background: #fff; border-radius: 10px; box-shadow: 0 12px 48px rgba(0, 0, 0, .28); overflow: hidden;
}
.z-modal-head {
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 10px 12px 10px 14px; border-bottom: 1px solid #eef1f4;
}
.z-modal-badge { flex: none; padding: 0 6px; font-size: 12px; line-height: 18px; color: #175199; background: #eaf1fa; border-radius: 3px; }
.z-modal-title {
  flex: 1 1 auto; min-width: 0; font-size: 14px; font-weight: 600; color: #1a1a1a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.z-modal-count { flex: none; font-size: 12px; color: #99a0a8; }
.z-modal-link { flex: none; font-size: 13px; color: #175199 !important; text-decoration: none !important; white-space: nowrap; }
.z-modal-link:hover { text-decoration: underline !important; }
.z-modal-sort { flex: none; display: flex; gap: 2px; padding: 2px; background: #f4f6f8; border-radius: 6px; }
.z-modal-sort button { padding: 3px 10px; border: 0; border-radius: 4px; background: transparent; font-size: 12px; color: #6b7a8c; cursor: pointer; }
.z-modal-sort button:hover { color: #175199; }
.z-modal-sort button.on { background: #fff; color: #175199; box-shadow: 0 1px 2px rgba(0, 0, 0, .08); }
.z-modal-close {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: #7b8794; cursor: pointer;
}
.z-modal-close:hover { background: #f1f4f7; color: #1a1a1a; }

/* 评论列表 */
.z-cmt-body {
  position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto;
  overscroll-behavior: contain; background: #fff; padding: 6px 16px 10px; font-size: 14px;
}
.z-cmt { display: flex; gap: 10px; padding: 12px 0; border-top: 1px solid #f2f4f7; }
.z-cmt:first-child { border-top: 0; }
.z-cmt-top { margin: 8px 0 0; padding: 10px; border-top: 0; background: #fafcff; border-radius: 6px; }
.z-cmt-face { flex: none; width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #f1f3f5; }
.z-cmt-box { flex: 1 1 auto; min-width: 0; }
.z-cmt-name { font-size: 13px; font-weight: 600; line-height: 1.4; color: #1a1a1a; }
.z-cmt-up {
  display: inline-block; margin-left: 6px; padding: 0 4px; font-size: 10px; font-weight: 400;
  line-height: 15px; color: #fff; background: #fb7299; border-radius: 3px; vertical-align: 1px;
}
.z-cmt-text { margin-top: 3px; font-size: 14px; line-height: 1.72; color: #1a1a1a; word-break: break-word; }
.z-cmt-emote { height: 20px; vertical-align: -4px; }
.z-cmt-at { color: #175199; }
.z-cmt-pic { display: block; max-width: 100%; max-height: 150px; margin-top: 8px; border-radius: 4px; }
.z-cmt-meta { display: flex; align-items: center; gap: 14px; margin-top: 6px; font-size: 12px; color: #99a0a8; }
.z-cmt-subs { margin-top: 8px; padding: 4px 10px; background: #f7f9fb; border-radius: 6px; }
.z-cmt-subs .z-cmt { padding: 6px 0; border-top: 0; }
.z-cmt-sub .z-cmt-face { width: 22px; height: 22px; }
.z-cmt-sub .z-cmt-name { font-size: 12px; font-weight: 500; color: #5b6673; }
.z-cmt-sub .z-cmt-text { font-size: 13px; }
.z-cmt-btn { margin-top: 8px; padding: 0; border: 0; background: none; font-size: 12px; color: #175199; cursor: pointer; }
.z-cmt-btn:hover { text-decoration: underline; }
.z-cmt-status { padding: 18px 0 12px; text-align: center; font-size: 12px; color: #99a0a8; }
.z-cmt-status[data-retry="1"] { color: #175199; cursor: pointer; text-decoration: underline; }

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
    // document-start 时 head 可能还不存在，等到能挂上为止（最多 300ms）
    (function mount(n) {
      const root = document.head || document.documentElement;
      if (root) { root.appendChild(style); return; }
      if (n > 300) return;
      setTimeout(() => mount(n + 1), 1);
    })(0);
  }
  injectStyle(css);

  /* ===================== 3. 工具 ===================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 建节点：el('span', 'z-label', '简介') */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const cleanText = (s) => (s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  /** 保留段落换行的清理（展开全文时用） */
  const rawClean = (s) => (s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u3000]+/g, ' ')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const oneLine = (s) => (s || '').replace(/\n+/g, ' ');
  /** 只有标点/空白（比如 "-"、"。。。"）的简介当成空的 */
  const meaningful = (t) => t.replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '').length >= 2;
  /** 截到 n 字，超出加省略号 */
  const clip = (text, n) => {
    const t = oneLine(text).replace(/\s{2,}/g, ' ').trim();
    return t.length > n ? t.slice(0, n).trimEnd() + '…' : t;
  };

  const pad2 = (n) => String(n).padStart(2, '0');

  /** 12345 -> 1.2万 / 1.2亿 */
  const fmtNum = (n) => {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  };

  /** 秒 -> 00:12 / 1:02:03 */
  const fmtTime = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    return (h ? h + ':' : '') + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  };

  /** 相对时间：刚刚 / 3 分钟前 / 5 小时前 / 2 天前 / 2026-10-20 */
  function cmtWhen(ts) {
    const sec = Number(ts) || 0;
    if (!sec) return '';
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - sec);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
    const d = new Date(sec * 1000);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
  /** 头像 / 表情接口有时给 // 或 http://，HTTPS 页面会报 Mixed Content */
  const fixUrl = (u) => {
    const s = String(u || '');
    if (!s) return '';
    if (s.startsWith('//')) return 'https:' + s;
    return s.startsWith('http://') ? 'https://' + s.slice(7) : s;
  };

  /** 页面底部飘一句轻提示（点赞成功 / 未登录 / 风控） */
  let toastTimer = 0;
  function toast(text) {
    if (!text) return;
    let node = document.querySelector('.z-toast');
    if (!node) {
      node = el('div', 'z-toast');
      (document.body || document.documentElement).appendChild(node);
    }
    node.textContent = text;
    node.style.display = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.style.display = 'none'; }, 2200);
  }

  /* ===================== 4. 缓存 ===================== */
  const CACHE_KEY = 'zbili:desc:v4';
  const TTL = 7 * 24 * 3600 * 1000;
  const SUB_KEY = 'zbili:sub:v2';
  const SUB_TTL = 3 * 24 * 3600 * 1000;
  const SUB_MAX_ENTRIES = 30;

  const loadJSON = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; }
  };

  /** 条数超过 max 时按时间淘汰，只留 keep 条 */
  function trimByTime(obj, max, keep) {
    const list = Object.entries(obj);
    if (list.length <= max) return obj;
    list.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
    return Object.fromEntries(list.slice(0, keep));
  }

  let cache = loadJSON(CACHE_KEY);
  let subCache = loadJSON(SUB_KEY);
  // v1 存的是 60 字合并后的长文本（无时间轴），已不再使用且体积很大
  try { localStorage.removeItem('zbili:sub:v1'); } catch (e) { /* 忽略 */ }
  let cacheDirty = false;
  let subDirty = false;

  setInterval(() => {
    if (cacheDirty) {
      cacheDirty = false;
      cache = trimByTime(cache, 800, 600);
      try {
        // 字幕正文体积大，单独存，不写进简介缓存；
        // subTried 只是内存里「别重复抓同一个视频」的标记，写进缓存会让字幕在下次打开时永远显示「暂无字幕」
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache, (k, v) => (
          (k === 'sub' || k === 'subTried') ? undefined : v
        )));
      } catch (e) { /* 存不下就算了 */ }
    }
    if (subDirty) {
      subDirty = false;
      subCache = trimByTime(subCache, SUB_MAX_ENTRIES, SUB_MAX_ENTRIES);
      try { localStorage.setItem(SUB_KEY, JSON.stringify(subCache)); } catch (e) { /* 忽略 */ }
    }
  }, 20000);

  /* ===================== 5. 网络 ===================== */
  const API = 'https://api.bilibili.com';
  const VIEW_API = API + '/x/web-interface/view?bvid=';
  const TAG_API = API + '/x/tag/archive/tags?bvid=';
  const NAV_API = API + '/x/web-interface/nav';
  const PLAYER_API = API + '/x/player/wbi/v2?';
  const REPLY_API = API + '/x/v2/reply?';
  const REPLY_SUB_API = API + '/x/v2/reply/reply?';
  const LIKE_API = API + '/x/web-interface/archive/like'; // POST bvid/like/csrf
  const HAS_LIKE_API = API + '/x/web-interface/archive/has/like?bvid='; // GET 是否已点赞
  const REPLY_PS = 20;
  const REPLY_SORT = { hot: 1, new: 0 }; // sort=1 按点赞（热门）/ sort=0 按时间（最新）

  const fetchJSON = async (url) => (await fetch(url, { credentials: 'include' })).json();
  /** POST 表单到 api.bilibili.com（点赞用；会自动带上 .bilibili.com 的 Cookie） */
  const postForm = async (url, data) => (await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString(),
  })).json();
  /** CSRF Token：B 站把 bili_jct 写在 Cookie 里，没有就是没登录 */
  function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  /** 风控码：-352 风控校验失败 / -412 请求被拦截 */
  const isBlocked = (code) => code === -352 || code === -412;

  const queue = [];
  let activeCount = 0;
  let apiBlocked = false;

  /** 被风控后清空队列（卡片退化为占位文字），30 秒后自动恢复 */
  function blockApi() {
    if (apiBlocked) return;
    apiBlocked = true;
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

  const requestDesc = (bvid) => new Promise((resolve) => { queue.push({ bvid, resolve }); pump(); });

  /* ===================== 6. 简介 ===================== */
  const hitsFresh = (rec) => rec && typeof rec === 'object' && Date.now() - rec.t < TTL;

  async function fetchDesc(bvid) {
    const hit = cache[bvid];
    if (hit && hitsFresh(hit)) return ensureSubtitle(hit);

    await sleep(200); // 轻微错峰，降低风控概率
    const json = await fetchJSON(VIEW_API + bvid);
    if (json.code !== 0) {
      if (isBlocked(json.code)) blockApi();
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
        const tj = await fetchJSON(TAG_API + bvid);
        if (tj.code === 0) tags = (tj.data || []).map((t) => t.tag_name).filter(Boolean).slice(0, 5);
        else if (isBlocked(tj.code)) blockApi();
      } catch (e) { /* 标签拿不到不影响主流程 */ }
    }

    const rec = {
      d: desc,
      tg: tags,
      s: { like: st.like || 0, reply: st.reply || 0, fav: st.favorite || 0 },
      aid: d.aid || 0,
      cid: d.cid || (d.pages && d.pages[0] && d.pages[0].cid) || 0,
      t: Date.now(),
    };
    cache[bvid] = rec;
    cacheDirty = true;
    return ensureSubtitle(rec);
  }

  /* ===================== 7. 字幕（视频文稿） ===================== */
  const SUB_MAX_LINES = 1200; // 长直播文稿会非常多，截断一下
  const SUB_MAX_CHARS = 60000;

  /** 是否需要抓字幕（按 subtitleMode 判断） */
  function subtitleNeeded(desc) {
    if (!CONFIG.subtitleMode || CONFIG.subtitleMode === 'off') return false;
    return CONFIG.subtitleMode === 'noDesc' ? !desc : true;
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

  /* --- WBI 签名（B 站接口 2023 年起必须带 w_rid / wts） --- */
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
    const nav = await fetchJSON(NAV_API);
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
    const q = Object.keys(all).sort()
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(all[k]).replace(/[!'()*]/g, '')))
      .join('&');
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
    return byLan(/^(zh-CN|zh-Hans|zh)$/i) || byLan(/^ai-zh/i) || byLan(/^zh/i) || usable[0];
  }

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
      if (!c) return true;
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

    // 老的合并法：攒够 60 字，或停顿超过 1.5s 才断开
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

  async function fetchSubtitleLines(aid, cid) {
    if (!aid || !cid) return [];
    const key = aid + '_' + cid;
    const hit = subCache[key];
    if (hit && Array.isArray(hit.l) && Date.now() - hit.t < SUB_TTL) return hit.l;

    const qs = await wbiSign({ aid, cid });
    if (!qs) return [];
    await sleep(120);
    const json = await fetchJSON(PLAYER_API + qs);
    if (json.code !== 0) {
      if (isBlocked(json.code)) blockApi();
      return [];
    }
    const sub = pickSubtitle(json.data && json.data.subtitle && json.data.subtitle.subtitles);
    if (!sub) return [];

    let body = [];
    try {
      const raw = await gmGetText(fixUrl(sub.subtitle_url));
      body = (JSON.parse(raw).body) || [];
    } catch (e) { return []; }

    const lines = subtitleToLines(body);
    if (!lines.length) return [];
    subCache[key] = { l: lines, t: Date.now() };
    subDirty = true;
    return lines;
  }

  /* ===================== 8. 卡片 ===================== */
  const ICONS = {
    // Feather 图标：thumbs-up / message-circle / star
    like: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
    comment: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    fav: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  };
  const ACT_LABELS = { like: '点赞', comment: '评论', fav: '收藏' };
  const CHEV = '<svg class="z-chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
    + '<path d="M4 6.5L8 10.5L12 6.5" fill="none" stroke="currentColor" stroke-width="1.6"'
    + ' stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function setMoreLabel(moreEl, label) {
    const t = moreEl.querySelector('.z-more-text');
    if (t) t.textContent = label;
    else moreEl.textContent = label;
  }
  function setLabel(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  /** 「阅读全文」/「展开字幕」这种就地展开的文字按钮 */
  function makeMore(text, extraClass) {
    const more = el('span', extraClass ? 'z-more ' + extraClass : 'z-more');
    more.setAttribute('role', 'button');
    more.tabIndex = 0;
    more.innerHTML = '<span class="z-more-text">' + text + '</span>' + CHEV;
    return more;
  }

  /** 时间点：显示 00:12，点击跳到视频的那一秒（卡片本身是链接，别让点击冒泡） */
  function subTimeLink(sec, bvid) {
    const at = Math.max(0, Math.floor(Number(sec) || 0));
    const a = el('a', 'z-sub-t', fmtTime(at));
    a.title = '从 ' + fmtTime(at) + ' 开始播放';
    if (bvid) a.href = 'https://www.bilibili.com/video/' + bvid + '?t=' + at;
    a.target = '_blank';
    a.rel = 'noopener';
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  }

  function makeSubLine(item, bvid) {
    const line = el('div', 'z-sub-line');
    if (CONFIG.showSubTime) line.appendChild(subTimeLink(item[0], bvid));
    line.appendChild(el('span', 'z-sub-c', String(item[1] || '')));
    return line;
  }

  /* ===== 展开字幕后的「收起」悬浮按钮 =====
   * 字幕展开后可能几百行，内联「收起」被顶到很下面，得一路滚到底才点得到。
   * 所以：内联「收起」不在视口里、而字幕块还在视口里时，右下角浮一个「收起字幕」，
   * 点它＝点内联的那个（并且顺手把字幕块滚回视野中间，别让页面突然跳到别处）。 */
  let zFloatBtn = null;
  let zFloatOwner = null;
  let zFloatIO = null;

  function ensureFloatBtn() {
    if (zFloatBtn && zFloatBtn.isConnected) return zFloatBtn;
    const btn = el('span', 'z-sub-float');
    btn.setAttribute('role', 'button');
    btn.tabIndex = 0;
    btn.title = '收起字幕，回到字幕开头';
    btn.innerHTML = '<span class="z-more-text">收起字幕</span>' + CHEV;
    const run = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      const owner = zFloatOwner;
      if (!owner) return;
      owner.toggle();
      // 收起后行数骤减，页面会往上跳，顺手把字幕块拉回视野
      if (owner.wrap && owner.wrap.isConnected) {
        try { owner.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        catch (e) { owner.wrap.scrollIntoView(); }
      }
    };
    btn.addEventListener('click', run);
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') run(ev);
    });
    (document.body || document.documentElement).appendChild(btn);
    zFloatBtn = btn;
    return btn;
  }

  function hideFloat() {
    if (zFloatBtn) zFloatBtn.classList.remove('z-on');
  }

  /** 解绑悬浮「收起」（内联「收起」被点、或卡片被重渲染时调用） */
  function releaseFloat(wrap) {
    if (wrap && zFloatOwner && zFloatOwner.wrap !== wrap) return;
    if (zFloatIO) {
      zFloatIO.disconnect();
      zFloatIO = null;
    }
    zFloatOwner = null;
    hideFloat();
  }

  /** 挂上悬浮「收起」：同一时刻只服务最后展开的那一个字幕块 */
  function mountFloat(wrap, more, toggle) {
    releaseFloat();
    const btn = ensureFloatBtn();
    zFloatOwner = { wrap, more, toggle };
    if (!('IntersectionObserver' in window)) {
      btn.classList.add('z-on');
      return;
    }
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => seen.set(en.target, en.isIntersecting));
      if (!zFloatOwner || zFloatOwner.wrap !== wrap) return;
      if (!wrap.isConnected || !more.isConnected) {
        releaseFloat(wrap);
        return;
      }
      // 内联「收起」看得见 → 不用浮；字幕块都滚出视口了 → 浮着也没意义
      if (seen.get(more) || !seen.get(wrap)) hideFloat();
      else btn.classList.add('z-on');
    }, { threshold: 0 });
    io.observe(wrap);
    io.observe(more);
    zFloatIO = io;
  }

  /** 字幕块：原生时间轴一条一行，先露前 N 条，点「展开字幕」把剩下的接着往下排 */
  function buildSubBlock(slot, lines, bvid) {
    if (!slot) return;
    slot.textContent = '';
    const items = (Array.isArray(lines) ? lines : [])
      .map((it) => (Array.isArray(it) ? [Number(it[0]) || 0, String(it[1] || '').trim()] : null))
      .filter((it) => it && it[1]);
    if (!items.length) return;

    const wrap = el('div', 'z-sub z-sub-lines');
    wrap.appendChild(el('span', 'z-label', '字幕'));
    const list = el('div', 'z-sub-list');
    wrap.appendChild(list);

    const maxLines = CONFIG.subtitlePreviewLines > 0 ? CONFIG.subtitlePreviewLines : items.length;
    const head = items.slice(0, maxLines);
    const rest = items.slice(maxLines);
    head.forEach((it) => list.appendChild(makeSubLine(it, bvid)));
    slot.appendChild(wrap);
    if (!rest.length) return;

    const more = makeMore('展开字幕', 'z-sub-more');
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
        releaseFloat(wrap);
        return;
      }
      // 展开：把剩下的行接在后面，不另开面板、不内部滚动
      if (!restNodes) restNodes = rest.map((it) => makeSubLine(it, bvid));
      const frag = document.createDocumentFragment();
      restNodes.forEach((n) => frag.appendChild(n));
      list.insertBefore(frag, more);
      more.classList.add('z-open');
      if (CONFIG.allowCollapse) {
        setMoreLabel(more, '收起');
        mountFloat(wrap, more, toggle);
      } else {
        more.style.display = 'none';
      }
    };
    more.addEventListener('click', toggle);
    more.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') toggle(ev);
    });
  }

  /** 没字幕：也给一个提示，别让用户以为脚本没生效 */
  function buildSubEmpty(slot) {
    if (!slot) return;
    slot.textContent = '';
    const wrap = el('div', 'z-sub z-row');
    wrap.appendChild(el('span', 'z-label', '字幕'));
    const hint = el('span', 'z-sub-text z-hint', '暂无字幕');
    hint.title = '该视频没有文稿字幕；AI 字幕需要登录 B 站后才会返回';
    wrap.appendChild(hint);
    slot.appendChild(wrap);
  }

  function bindExpand(descEl, moreEl, fullText) {
    const toggle = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (descEl.classList.contains('z-expanded')) {
        descEl.textContent = descEl.dataset.preview || '';
        descEl.classList.remove('z-expanded');
        moreEl.classList.remove('z-open');
        setMoreLabel(moreEl, '阅读全文');
        return;
      }
      descEl.textContent = fullText;
      descEl.classList.add('z-expanded');
      moreEl.classList.add('z-open');
      setMoreLabel(moreEl, CONFIG.allowCollapse ? '收起' : '');
      if (!CONFIG.allowCollapse) moreEl.style.display = 'none';
    };
    moreEl.addEventListener('click', toggle);
    moreEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); }
    });
  }

  function buildActions(url, bvid, title) {
    const acts = el('div', 'z-actions');
    acts.style.display = 'none'; // 拿到统计数据后再显示，避免占位跳动
    Object.keys(ICONS).forEach((key) => {
      const a = el('a', 'z-act z-act-' + key);
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
        // 评论不跳页，就地开弹窗（拿 aid 查评论接口）
        a.removeAttribute('target');
        a.setAttribute('role', 'button');
        a.title = '在弹窗里看评论区';
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openCommentModal(bvid, title);
        });
      }
      if (key === 'like' && CONFIG.likeInPlace && bvid) {
        // 点赞不跳页，就地调接口（需要登录 + Cookie 里的 bili_jct）
        a.removeAttribute('target');
        a.setAttribute('role', 'button');
        a.setAttribute('aria-pressed', 'false');
        a.title = '点赞';
        a.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleLike(a, bvid);
        });
        // 鼠标扫过时才查一次「是否已点赞」（只查一次，不给每张卡都白打一个请求）
        const syncLiked = async () => {
          if (a.dataset.busy === '1' || a.dataset.sync === '1') return;
          a.dataset.sync = '1';
          try {
            const json = await fetchJSON(HAS_LIKE_API + bvid);
            if (json.code !== 0) return;
            if (a.dataset.userSet === '1') return; // 用户已经点过了，别拿旧状态盖掉
            setLiked(a, Number(json.data) === 1);
          } catch (e) { /* 查不到就当未点赞 */ }
        };
        a.addEventListener('mouseenter', syncLiked, { once: true });
        a.addEventListener('focus', syncLiked, { once: true });
      }
      if (key === 'fav' && !CONFIG.favClickable) {
        // 收藏没法在卡片里完成，做成不可点的静态数字，避免「点一下就跳视频页」的误导
        a.removeAttribute('href');
        a.removeAttribute('target');
        a.removeAttribute('rel');
        a.classList.add('z-static');
        a.title = '收藏数（收藏请进视频页）';
        a.setAttribute('aria-label', '收藏数');
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
      const a = acts.querySelector('.z-act-' + key);
      const node = a && a.querySelector('.z-act-num');
      if (!node) return;
      a.dataset.base = String(Number(val) || 0);
      renderActNum(a);
    };
    put('like', stat.like);
    put('comment', stat.reply);
    put('fav', stat.fav);
    acts.style.display = '';
  }

  /** 数字 = 服务器给的统计值 + 本地操作带来的增量 */
  function renderActNum(a) {
    const node = a.querySelector('.z-act-num');
    if (!node) return;
    const base = Number(a.dataset.base || 0);
    const delta = Number(a.dataset.delta || 0);
    node.textContent = fmtNum(Math.max(0, base + delta));
  }

  /**
   * 点赞态：图标变红实心 + 数字跟着变。
   * delta 是本次操作给 stat.like 带来的增量（undefined = 只改状态、不动数字）：
   * B 站统计里已经包含自己那一票，所以「发现已点赞」不能 +1。
   */
  function setLiked(a, liked, delta) {
    a.classList.toggle('z-liked', !!liked);
    a.setAttribute('aria-pressed', liked ? 'true' : 'false');
    a.title = liked ? '已点赞，再点一次取消' : '点赞';
    if (delta !== undefined) a.dataset.delta = String(delta);
    renderActNum(a);
  }

  /** 点赞 / 取消点赞：直接调 web 接口（POST archive/like），不跳视频页 */
  async function toggleLike(a, bvid) {
    if (a.dataset.busy === '1') return;
    const csrf = getCsrf();
    if (!csrf) {
      toast('请先登录 B 站再点赞');
      return;
    }
    const wasLiked = a.classList.contains('z-liked');
    const prevDelta = Number(a.dataset.delta || 0);
    a.dataset.userSet = '1';
    a.dataset.busy = '1';
    a.classList.add('z-busy');
    try {
      const json = await postForm(LIKE_API, { bvid, like: wasLiked ? 2 : 1, csrf });
      const code = Number(json && json.code);
      if (code === 0) {
        setLiked(a, !wasLiked, prevDelta + (wasLiked ? -1 : 1));
        toast(wasLiked ? '已取消点赞' : '已点赞');
        return;
      }
      // 65006 重复点赞 / 65004 取消点赞失败：本地状态和服务器不同步，按服务器的结果纠正，数字不动
      if (code === 65006) { setLiked(a, true); toast('这个视频之前已经点过赞了'); return; }
      if (code === 65004) { setLiked(a, false); toast('这个视频现在是未点赞状态'); return; }
      if (code === -101) { toast('请先登录 B 站再点赞'); return; }
      if (code === -111) { toast('登录状态过期了，刷新页面后再试'); return; }
      if (isBlocked(code)) { toast('操作太频繁，被 B 站风控了，过一会儿再试'); return; }
      toast((json && json.message) || '点赞失败，稍后再试');
    } catch (e) {
      toast('点赞失败，检查一下网络后重试');
    } finally {
      // 留一点冷却，避免连点打太快被风控
      setTimeout(() => {
        a.dataset.busy = '0';
        a.classList.remove('z-busy');
      }, 600);
    }
  }

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

      // 字幕：抓到就显示预览 +「展开字幕」，抓不到也给个提示
      if (subtitleNeeded(full)) {
        if (sub.length) buildSubBlock(slot, sub, bvid);
        else buildSubEmpty(slot);
      }

      fillActions(card, rec.s);
    });
  }

  /** 把一张 B 站卡片改造成「标题 + UP主：简介 + 字幕」 */
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
      // 番剧 / 活动 / 广告卡：封面已经隐藏，留着只会剩一块空白
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

    const box = el('div', 'z-answer');

    // 第一行：UP主：
    const byline = el('div', 'z-byline');
    const authorA = el('a', 'z-author', author);
    if (ownerEl && ownerEl.href) { authorA.href = ownerEl.href; authorA.target = '_blank'; }
    byline.append(authorA, el('span', 'z-colon', '：'));
    box.appendChild(byline);

    // 第二块：简介（和字幕一样带一个小徽章）
    const descRow = el('div', 'z-row z-desc-row');
    const descEl = el('span', 'z-desc z-pending', '简介加载中…');
    const moreEl = makeMore('阅读全文');
    moreEl.style.display = 'none'; // 只有简介被截断时才出现
    descRow.append(el('span', 'z-label z-desc-label', '简介'), descEl, moreEl);
    box.appendChild(descRow);

    // 字幕块的容器（跟在简介后面、meta 前面）
    const slot = el('div', 'z-sub-slot');
    box.appendChild(slot);

    if (CONFIG.showMeta) {
      const bits = [];
      if (statTexts[0]) bits.push(statTexts[0] + ' 播放');
      if (statTexts[1]) bits.push(statTexts[1] + ' 弹幕');
      if (dur) bits.push(dur);
      const d = cleanText(date).replace(/^·\s*/, '');
      if (d) bits.push(d);
      if (bits.length) box.appendChild(el('div', 'z-meta', bits.join(' · ')));
    }

    tit.insertAdjacentElement('afterend', box);
    if (CONFIG.showActions) box.appendChild(buildActions(link ? link.href : href, bvid, tit.textContent));
    card.dataset.zbBvid = bvid;
    card.dataset.zbState = 'ok';

    if (io) io.observe(card);
    else loadDesc(card);
  }

  /* ===================== 9. 评论弹窗 ===================== */
  let modal = null;

  function closeCommentModal() {
    if (!modal) return;
    document.removeEventListener('keydown', modal.onKey, true);
    document.documentElement.style.overflow = modal.prevOverflow;
    modal.mask.remove();
    modal = null;
  }

  const fetchAid = async (bvid) => {
    const json = await fetchJSON(VIEW_API + bvid);
    if (json.code !== 0 || !json.data || !json.data.aid) throw new Error(json.message || '获取视频信息失败');
    return json.data.aid;
  };

  /** 评论正文 -> 安全 HTML（转义 + 表情图 + @人高亮 + 换行） */
  function cmtHtml(content) {
    const c = content || {};
    let html = escapeHtml(c.message);
    Object.keys(c.emote || {}).forEach((key) => {
      const src = fixUrl(c.emote[key] && c.emote[key].url);
      if (!src) return;
      const img = '<img class="z-cmt-emote" src="' + src + '" alt="' + escapeHtml(key) + '" loading="lazy">';
      html = html.split(escapeHtml(key)).join(img);
    });
    (c.members || []).forEach((m) => {
      if (!m || !m.uname) return;
      const at = escapeHtml('@' + m.uname);
      html = html.split(at).join('<span class="z-cmt-at">' + at + '</span>');
    });
    return html.replace(/\n/g, '<br>');
  }

  function makeCmtPics(content) {
    const pics = (content && content.pictures) || [];
    if (!pics.length) return null;
    const frag = document.createDocumentFragment();
    pics.slice(0, 3).forEach((p) => {
      const img = el('img', 'z-cmt-pic');
      img.loading = 'lazy';
      img.alt = '';
      img.src = fixUrl(p && p.img_src);
      frag.appendChild(img);
    });
    return frag;
  }

  /** 子回复：展开「N 条回复」，按 pn 翻页并按 rpid 去重 */
  async function loadSubReplies(btn, subs, reply, ctx, seen) {
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const pn = Number(btn.dataset.pn) || 1;
    btn.textContent = '加载中…';
    try {
      const url = REPLY_SUB_API + 'oid=' + ctx.aid + '&type=1&root=' + (reply.rpid_str || reply.rpid)
        + '&ps=10&pn=' + pn;
      const json = await fetchJSON(url);
      if (json.code !== 0) throw new Error(json.message || '加载失败');
      const data = json.data || {};
      const frag = document.createDocumentFragment();
      let added = 0;
      (data.replies || []).forEach((r) => {
        const key = String(r.rpid);
        if (seen.has(key)) return;
        seen.add(key);
        frag.appendChild(makeCommentItem(r, { sub: true, upMid: ctx.upMid }));
        added++;
      });
      subs.appendChild(frag);
      const total = Number((data.page && data.page.count) || 0);
      if (added && seen.size < total) {
        btn.dataset.pn = String(pn + 1);
        btn.textContent = '展开更多回复（还有 ' + (total - seen.size) + ' 条）';
      } else {
        btn.remove();
      }
    } catch (e) {
      btn.textContent = '加载失败，点我重试';
    } finally {
      if (btn.isConnected) btn.dataset.busy = '0';
    }
  }

  /** 一条评论（顶层 / 子回复共用） */
  function makeCommentItem(reply, opts) {
    const o = opts || {};
    const item = el('div', o.sub ? 'z-cmt z-cmt-sub' : 'z-cmt');

    const face = el('img', 'z-cmt-face');
    face.loading = 'lazy';
    face.alt = '';
    face.src = fixUrl(reply.member && reply.member.avatar);
    face.addEventListener('error', () => { face.style.visibility = 'hidden'; }, { once: true });

    const boxEl = el('div', 'z-cmt-box');
    const name = el('div', 'z-cmt-name', (reply.member && reply.member.uname) || '匿名用户');
    if (o.upMid && reply.member && String(reply.member.mid) === String(o.upMid)) {
      name.appendChild(el('span', 'z-cmt-up', 'UP'));
    }

    const textEl = el('div', 'z-cmt-text');
    textEl.innerHTML = cmtHtml(reply.content);
    const pics = makeCmtPics(reply.content);
    if (pics) textEl.appendChild(pics);

    const meta = el('div', 'z-cmt-meta');
    meta.appendChild(el('span', null, cmtWhen(reply.ctime)));
    if (Number(reply.like) > 0) meta.appendChild(el('span', 'z-cmt-like', '👍 ' + fmtNum(reply.like)));
    boxEl.append(name, textEl, meta);

    // 子回复：接口一般直接带 3 条预览，剩下的点按钮再拉
    const subs = el('div', 'z-cmt-subs');
    const preview = reply.replies || [];
    const seen = new Set();
    preview.forEach((r) => {
      seen.add(String(r.rpid));
      subs.appendChild(makeCommentItem(r, { sub: true, upMid: o.upMid }));
    });
    if (subs.childElementCount) boxEl.appendChild(subs);

    const total = Number(reply.rcount) || 0;
    if (!o.sub && total > 0 && seen.size < total && o.aid) {
      const btn = el('button', 'z-cmt-btn',
        seen.size ? '展开更多回复（还有 ' + (total - seen.size) + ' 条）' : '共 ' + total + ' 条回复');
      btn.type = 'button';
      btn.dataset.pn = '1';
      btn.addEventListener('click', () => {
        if (!subs.parentNode) boxEl.insertBefore(subs, btn);
        loadSubReplies(btn, subs, reply, { aid: o.aid, upMid: o.upMid }, seen);
      });
      boxEl.appendChild(btn);
    }

    item.append(face, boxEl);
    return item;
  }

  const SVG_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"'
    + ' stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function openCommentModal(bvid, title) {
    if (!CONFIG.commentModal || !bvid) return;
    if (modal) closeCommentModal();

    const token = {}; // 关掉弹窗后，晚到的响应靠它丢弃
    const state = {
      aid: 0,
      sort: REPLY_SORT[CONFIG.commentSort] !== undefined ? CONFIG.commentSort : 'hot',
      pn: 0,
      done: false,
      loading: false,
      upMid: 0,
      count: 0,
      seen: new Set(),
    };

    const mask = el('div', 'z-mask');
    mask.addEventListener('mousedown', (ev) => { if (ev.target === mask) closeCommentModal(); });

    const boxEl = el('div', 'z-modal');
    boxEl.setAttribute('role', 'dialog');
    boxEl.setAttribute('aria-modal', 'true');
    boxEl.setAttribute('aria-label', '评论');

    // ---- 头部：徽章 / 标题 / 共 N 条 / 排序 / 在B站打开 / 关闭 ----
    const head = el('div', 'z-modal-head');
    const ttl = el('div', 'z-modal-title', title || '视频评论');
    ttl.title = ttl.textContent;
    const countEl = el('span', 'z-modal-count');

    const sortBox = el('div', 'z-modal-sort');
    const sortBtns = {};
    [['hot', '热门'], ['new', '最新']].forEach(([key, label]) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.dataset.sort = key;
      b.addEventListener('click', () => {
        if (state.sort === key) return;
        state.sort = key;
        sortBtns.hot.classList.toggle('on', key === 'hot');
        sortBtns.new.classList.toggle('on', key === 'new');
        resetList();
        loadPage();
      });
      sortBtns[key] = b;
      sortBox.appendChild(b);
    });
    sortBtns[state.sort].classList.add('on');

    const openLink = el('a', 'z-modal-link', '在B站打开');
    openLink.href = 'https://www.bilibili.com/video/' + bvid + '/';
    openLink.target = '_blank';
    openLink.rel = 'noopener';
    openLink.addEventListener('click', (ev) => ev.stopPropagation());

    const close = el('button', 'z-modal-close');
    close.type = 'button';
    close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭');
    close.innerHTML = SVG_X;
    close.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeCommentModal();
    });

    head.append(el('span', 'z-modal-badge', '评论'), ttl, countEl, sortBox, openLink, close);

    // ---- 正文：评论列表（自己在弹窗内部滚） ----
    const bodyEl = el('div', 'z-cmt-body');
    const listEl = el('div', 'z-cmt-list');
    const statusEl = el('div', 'z-cmt-status');
    bodyEl.append(listEl, statusEl);
    statusEl.addEventListener('click', () => {
      if (statusEl.dataset.retry !== '1') return;
      statusEl.dataset.retry = '0';
      state.loading = false;
      loadPage();
    });

    boxEl.append(head, bodyEl);
    mask.appendChild(boxEl);

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

    modal = { mask, onKey, prevOverflow, token };

    // ---- 内部工具 ----
    function setStatus(text, opts) {
      statusEl.textContent = text || '';
      statusEl.style.display = text ? '' : 'none';
      statusEl.dataset.retry = (opts && opts.retry) ? '1' : '0';
    }

    function resetList() {
      state.pn = 0;
      state.done = false;
      state.loading = false;
      state.seen.clear();
      listEl.textContent = '';
      setStatus('加载中…');
    }

    async function loadPage() {
      if (state.loading || state.done || !state.aid) return;
      state.loading = true;
      setStatus('加载中…');
      try {
        const url = REPLY_API + 'oid=' + state.aid + '&type=1&pn=' + (state.pn + 1)
          + '&ps=' + REPLY_PS + '&sort=' + REPLY_SORT[state.sort];
        const json = await fetchJSON(url);
        if (!modal || modal.token !== token) return;
        if (json.code !== 0) {
          if (isBlocked(json.code)) blockApi();
          throw new Error(json.code === 12002 ? '评论区未开放' : (json.message || '加载失败'));
        }
        const data = json.data || {};
        state.pn++;
        state.upMid = (data.upper && data.upper.mid) || state.upMid;
        state.count = Number(data.page && data.page.count) || state.count;
        countEl.textContent = state.count ? '共 ' + fmtNum(state.count) + ' 条' : '';

        const frag = document.createDocumentFragment();
        const addNode = (r, isTop) => {
          if (!r || !r.rpid) return;
          const key = String(r.rpid);
          if (state.seen.has(key)) return;
          state.seen.add(key);
          const node = makeCommentItem(r, { aid: state.aid, upMid: state.upMid });
          if (isTop) node.classList.add('z-cmt-top');
          frag.appendChild(node);
        };
        if (state.pn === 1) {
          if (data.top && data.top.rpid) addNode(data.top, true);
          (data.top_replies || []).forEach((r) => addNode(r, true));
        }
        const list = data.replies || [];
        list.forEach((r) => addNode(r, false));
        listEl.appendChild(frag);

        if (!listEl.childElementCount) {
          state.done = true;
          setStatus('还没有评论');
        } else if (list.length < REPLY_PS) {
          state.done = true;
          setStatus('没有更多评论了');
        } else {
          setStatus('');
        }
      } catch (e) {
        setStatus((e && e.message ? e.message : '加载失败') + '，点这里重试', { retry: true });
      } finally {
        state.loading = false;
      }
    }

    // 滚到底自动加载下一页（提前 300px 预加载）
    bodyEl.addEventListener('scroll', () => {
      if (!modal || modal.token !== token) return;
      if (bodyEl.scrollTop + bodyEl.clientHeight < bodyEl.scrollHeight - 300) return;
      loadPage();
    });

    // 先拿 aid，再拉第一页
    (async () => {
      try {
        state.aid = await fetchAid(bvid);
      } catch (e) {
        if (modal && modal.token === token) {
          setStatus((e && e.message ? e.message : '获取视频信息失败') + '，点这里重试');
          statusEl.dataset.retry = '0';
        }
        return;
      }
      if (!modal || modal.token !== token) return;
      loadPage();
    })();
  }

  /* ===================== 10. 启动 ===================== */
  /** 可选：阻断封面图下载（默认关） */
  const IMG_SELECTOR = '.bili-video-card img, .bili-video-card picture source, .floor-card img, .recommended-swipe img';

  function stripImages(root) {
    if (!CONFIG.blockImageLoad) return;
    for (const img of (root || document).querySelectorAll(IMG_SELECTOR)) {
      if (img.dataset.biliNoCover) continue;
      img.dataset.biliNoCover = '1';
      try {
        img.removeAttribute('srcset');
        img.removeAttribute('src');
        img.removeAttribute('sizes');
        if (img.tagName === 'IMG') img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      } catch (e) { /* 忽略 */ }
    }
  }

  // 卡片进入视口前 600px 才开始请求简介，首屏不会一次打满队列
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          io.unobserve(en.target);
          loadDesc(en.target);
        });
      }, { rootMargin: '600px 0px' })
    : null;

  function scan() {
    stripImages(document);
    if (CONFIG.zhihuLayout) document.querySelectorAll('.bili-video-card').forEach(enhance);
  }

  // B 站是无限滚动 + 局部重渲染，用 MutationObserver 增量扫，一帧最多一次
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
