# 哔哩哔哩首页知乎风改造（油猴脚本）

把 bilibili.com 首页的推荐流改造成「知乎信息流」样式：

- **标题** = 视频标题（18px 加粗，hover 变蓝）
- **作者** = UP 主名称（可点进空间）
- **正文** = 视频简介（无简介时依次退化为「视频动态文字」→「标签」，都没有才显示占位文字）
- 点 `阅读全文 ⌄` **就地展开**全文，不跳转、不开新标签；展开后变 `收起`
- 简介本来就没被截断时，不显示「阅读全文」
- 封面图全部移除（推荐流卡片、顶部大轮播、直播/番剧楼层小卡、信息流里的直播卡、骨架占位）
- 卡片底部一行「👍 点赞 · 💬 评论 · ⭐ 收藏」（图标 + 数量，1.2万/亿 自动缩写），点击打开视频页
- 居中单列 760px、白底卡片 + 1px 分割线、浅灰页面底色

## 文件

| 文件 | 说明 |
| --- | --- |
| `bilibili-remove-covers.user.js` | 脚本本体（唯一需要维护的文件） |

## 配置

改脚本顶部 `CONFIG`，保存后刷新页面生效：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `zhihuLayout` | `true` | 改 `false` 只去封面，保留原本的网格布局 |
| `maxWidth` | `760` | 单列内容最大宽度 |
| `descMaxChars` | `200` | 简介预览字数，也是「是否出现阅读全文」的阈值 |
| `allowCollapse` | `true` | 展开后是否显示「收起」 |
| `showMeta` | `true` | 底部「播放 · 弹幕 · 时长 · 时间」小字 |
| `showActions` | `true` | 卡片底部「点赞 / 评论 / 收藏」操作栏（数量来自 view 接口） |
| `tagsAsFallback` | `true` | 简介/动态为空时用视频标签充当正文 |
| `useDynamicAsDesc` | `true` | 简介为空时用 UP 主的视频动态文字 |
| `fallbackDesc` | `（该 UP 主没有填写简介）` | 标签也没有时的占位文字 |
| `hideFloorCards` | `true` | 隐藏分区楼层（直播 / 番剧）小卡 |
| `hideLiveCards` | `true` | 隐藏信息流里的直播卡（封面已经藏了，留着只有大片空白） |
| `hideHeaderBanner` | `false` | 隐藏顶部站点 Banner 插画 |
| `blockImageLoad` | `false` | 阻断封面图下载（省流量，个别情况会让骨架屏不消失） |

## 实现要点

- **样式**：`document-start` 注入 `<style data-bili-no-cover>`，用 CSS 隐藏封面、重排卡片，动态节点自动生效。
- **结构**：在标题 `<h3>` 后插入 `.z-answer`（作者 + 简介 + 阅读全文），原 `__info--bottom` 由 CSS 隐藏。
- **卡片节奏**：B 站每张卡外面还套了一层 `.feed-card`，所以每张卡都是自己父节点的 `:last-child`；分割线不能靠 `:last-child` 判断，改为在容器层级去掉最后一张。外层 wrapper 自带的 24~40px 间距也统一压平，卡片之间只留 1px 分割线。
- **非投稿卡**：番剧 / 活动 / 广告 / 直播卡链接里没有 `BV` 号，封面藏掉后只会剩一块空白，直接标 `.z-skip` 不显示。
- **简介数据**：`/x/web-interface/view?bvid=` 取 `desc`（空则退 `dynamic`，再空则 `/x/tag/archive/tags` 取标签）。
  - 同一个响应里的 `stat.like / stat.reply / stat.favorite` 直接用于底部操作栏，不额外请求
  - 结果缓存在 `localStorage`（键 `zbili:desc:v3`，TTL 7 天）
  - 首屏外卡片由 `IntersectionObserver` 懒加载，队列 2 并发 + 错峰 200ms
  - 命中风控（-352 / -412）自动暂停 30 秒，期间卡片退化为占位文字
- **DOM 兜底**：`MutationObserver` 监听新增节点，Vue 重渲染后自动补回 `.z-answer`。

## 已知情况

- 页面底部部分灰块是 B 站自己的占位骨架（未装脚本也存在），脚本会隐藏它们。
- 控制台可能出现来自旧版本残留在子 iframe 的报错，刷新/重启浏览器后消失，不影响页面。
