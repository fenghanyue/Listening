/**
 * 单曲分享：把 track 组装成一段可以直接发进微信 / QQ 的纯文本
 *
 * 刻意不分享本站链接：本站跑在 Render 免费层（闲置会休眠、冷启动几十秒），
 * 域名又是免费托管的共享二级域名，微信对这类域名的风控不可控；加上音源全是
 * 第三方接口、拿到的播放地址还带时效签名，别人点开大概率是打不开或播不出声。
 * 所以分享出去的是歌曲在官方平台的页面 —— 不依赖本站是否在线，微信 / QQ 里
 * 必然能打开，还能唤起对方手机上的音乐 App。
 */

// 官方平台歌曲页的 URL 模板，集中放这里方便真机实测后调整
const URL_TEMPLATES = {
  // 服务端渲染的移动分享页。PC 端那个 /song?id= 是 hash 路由 SPA，
  // '#' 后面的内容根本不会发给服务器，拿不到歌曲信息
  netease: id => `https://music.163.com/m/song?id=${id}`,
  // 仅在 track.pageUrl（接口直接给的 h5 分享链接）缺失时兜底
  qq: mid => `https://y.qq.com/n/ryqq/songDetail/${mid}`,
};

/**
 * 构造歌曲在官方平台的页面链接
 * @param {object} track
 * @returns {string|null} 拿不到可靠链接时返回 null（调用方需要降级成纯歌曲信息）
 */
export function officialSongUrl(track) {
  if (!track) return null;

  switch (track.source) {
    case 'netease': {
      const id = String(track.songid ?? '').trim();
      // netease.js 的 mapMetingItem 在 meting 返回的 url 里取不到 id 时，会
      // fallback 成 `${keyword}-${idx+1}` 这种占位值（例如 "周杰伦-3"）。
      // 这种值拼进 URL 就是个打不开的坏链接，所以只认纯数字 id
      return /^\d+$/.test(id) ? URL_TEMPLATES.netease(id) : null;
    }

    case 'qq': {
      // pageUrl 来自接口的 song_h5_url，本来就是给分享用的 h5 链接，优先用它。
      // 注意它只在 fetchQQDetails 之后才有值，搜索结果里是没有的
      const pageUrl = String(track.pageUrl ?? '').trim();
      if (/^https?:\/\//.test(pageUrl)) return pageUrl;

      const mid = String(track.songMid || track.qqId || track.songid || '').trim();
      return mid ? URL_TEMPLATES.qq(encodeURIComponent(mid)) : null;
    }

    case 'soundcloud': {
      // permalink_url 是 SoundCloud API 返回的规范公开地址，直接可用
      const permalink = String(track.scPermalink ?? '').trim();
      return /^https?:\/\//.test(permalink) ? permalink : null;
    }

    default:
      return null;
  }
}

/**
 * 组装分享用的纯文本
 * @param {object} track
 * @returns {string} 形如 "《晴天》— 周杰伦\n专辑：叶惠美\n\nhttps://music.163.com/m/song?id=186016"
 */
export function shareText(track) {
  if (!track) return '';

  const lines = [];
  const title = (track.title || '').trim();
  const artist = (track.artist || '').trim();
  if (title && artist) lines.push(`《${title}》— ${artist}`);
  else if (title) lines.push(`《${title}》`);
  else if (artist) lines.push(artist);

  // 搜索结果里 QQ 和 SoundCloud 的 album 是空字符串，只有拉过详情的才有值
  const album = (track.album || '').trim();
  if (album) lines.push(`专辑：${album}`);

  const url = officialSongUrl(track);
  if (url) {
    // 链接单独成行、放在最后：微信靠空白字符判断 URL 边界，后面紧跟中文或
    // 标点会被一并吃进链接里，点开就是 404
    if (lines.length) lines.push('');
    lines.push(url);
  }

  return lines.join('\n');
}
