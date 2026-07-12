// 封面图片浏览器缓存：cache-first，命中直接返回，未命中联网后写入缓存。
// 只拦截图片请求（黑胶大图/队列缩略图/歌单列表的 background-image 也会触发 image 类型请求），
// 不碰音频、API 请求，避免影响播放和搜索逻辑。
const CACHE_NAME = 'listening-covers-v2';
const MAX_ENTRIES = 500;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.destination !== 'image') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') {
        await cache.put(event.request, response.clone());
        trimCache(cache);
      }
      return response;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});

// 简单数量上限，超过时删掉最早写入的几条（Cache 按写入顺序枚举 key）
async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const overflow = keys.length - MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]);
  }
}
