// ==UserScript==
// @name         哔哩哔哩 - 移除首页视频封面图
// @namespace    https://www.bilibili.com/
// @version      2.4.0
// @description  首页去封面 + 知乎风单列信息流：标题=视频标题，作者=UP主，正文=视频简介（点「阅读全文」就地展开），底部点赞 / 评论 / 收藏
// @author       you
// @match        https://www.bilibili.com/*
// @match        https://www.bilibili.com
// @run-at       document-start
// @grant        none
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

    /** 视频没有简介时显示的占位文字 */
    fallbackDesc: '（该 UP 主没有填写简介）',

    /** 简介为空时，是否退而使用 UP 主的"视频动态"文字 */
    useDynamicAsDesc: true,

    /** 简介和动态都为空时，是否改用视频标签（如 "标签：游戏 · 实况"） */
    tagsAsFallback: true,

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

/* 正文：UP主：简介 … 阅读全文 */
.z-answer {
  font-size: 15px !important;
  line-height: 1.75 !important;
  color: #4a4a4a !important;
  word-break: break-word;
}
.z-answer .z-author { color: #121212 !important; font-weight: 600 !important; text-decoration: none !important; }
.z-answer .z-author:hover { color: #175199 !important; }
.z-answer .z-colon { color: #121212 !important; }
.z-answer .z-desc { color: #4a4a4a !important; }
.z-answer .z-desc.z-pending { color: #b9c0c8 !important; }
.z-answer .z-desc.z-empty { color: #9aa4af !important; font-style: italic; }
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
  const CACHE_KEY = 'zbili:desc:v3';
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
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
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
    if (hit && hitsFresh(hit)) return hit;

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

    const rec = {
      d: desc,
      tg: tags,
      s: { like: st.like || 0, reply: st.reply || 0, fav: st.favorite || 0 },
      t: Date.now(),
    };
    cache[bvid] = rec;
    cacheDirty = true;
    return rec;
  }

  function hitsFresh(rec) {
    return rec && typeof rec === 'object' && Date.now() - rec.t < TTL;
  }

  /* ---------- 3.5 底部操作栏（点赞 / 评论 / 收藏） ---------- */
  const ICONS = {
    // Feather 图标：thumbs-up / message-circle / star
    like: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3',
    comment: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
    fav: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  };
  const ACT_LABELS = { like: '点赞', comment: '评论', fav: '收藏' };

  const fmtNum = (n) => {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  };

  function buildActions(url) {
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
    if (!descEl) return;

    requestDesc(bvid).then((rec) => {
      if (!descEl.isConnected) return;
      descEl.classList.remove('z-pending');
      const full = rec && typeof rec === 'object' ? (rec.d || '') : (rec || '');
      const tags = (rec && rec.tg) || [];

      if (full) {
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
        descEl.textContent = '标签：' + tags.join(' · ');
        descEl.classList.add('z-tags');
        if (moreEl) moreEl.style.display = 'none';
      } else {
        descEl.textContent = CONFIG.fallbackDesc;
        descEl.classList.add('z-empty');
        if (moreEl) moreEl.style.display = 'none';
      }

      fillActions(card, rec && rec.s);
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

    const authorA = document.createElement('a');
    authorA.className = 'z-author';
    authorA.textContent = author;
    if (ownerEl && ownerEl.href) { authorA.href = ownerEl.href; authorA.target = '_blank'; }
    box.appendChild(authorA);

    const colon = document.createElement('span');
    colon.className = 'z-colon';
    colon.textContent = '：';
    box.appendChild(colon);

    const descEl = document.createElement('span');
    descEl.className = 'z-desc z-pending';
    descEl.textContent = '简介加载中…';
    box.appendChild(descEl);

    const moreEl = document.createElement('span');
    moreEl.className = 'z-more';
    moreEl.setAttribute('role', 'button');
    moreEl.tabIndex = 0;
    moreEl.style.display = 'none'; // 默认不显示，只有简介被截断时才出现
    moreEl.innerHTML = '<span class="z-more-text">阅读全文</span>'
      + '<svg class="z-chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
      + '<path d="M4 6.5L8 10.5L12 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    box.appendChild(moreEl);

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
    if (CONFIG.showActions) box.appendChild(buildActions(link ? link.href : href));
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
