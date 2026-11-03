// 展示资料队列：只查询当前需要显示的 QQ 曲目，音频下载仍由播放器负责。
export const metadataKey = track => track?.source === 'qq'
  ? String(track.qqId || track.songMid || track.songid || '') : '';
const needsMetadata = track => !!metadataKey(track) && (!track.cover || !track.album);

export class TrackMetadataLoader {
  constructor({ fetchMetadata, onMetadata, now = Date.now, timeout = 8000 }) {
    Object.assign(this, { fetchMetadata, onMetadata, now, timeout });
    this.targets = new Map();
    this.jobs = new Map();
    this.cache = new Map();
  }

  update(tracks, { online = true } = {}) {
    this.targets = new Map((online ? tracks : []).filter(needsMetadata).map(track => [metadataKey(track), track]));
    for (const [key, job] of this.jobs) {
      if (!this.targets.has(key)) job.controller.abort();
    }
    for (const [key, track] of this.targets) {
      const cached = this.cache.get(key);
      if (cached?.value && cached.until > this.now()) this.onMetadata(key, cached.value);
      if (!needsMetadata(track)) this.targets.delete(key);
    }
    this.pump();
  }

  pump() {
    for (const [key, track] of this.targets) {
      if (this.jobs.size >= 2) break;
      if (this.jobs.has(key) || !needsMetadata(track) || this.cache.get(key)?.until > this.now()) continue;
      const controller = new AbortController();
      const job = { controller, timedOut: false };
      this.jobs.set(key, job);
      const timer = setTimeout(() => { job.timedOut = true; controller.abort(); }, this.timeout);
      const aborted = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('metadata query aborted')), { once: true });
      });
      Promise.race([Promise.resolve().then(() => this.fetchMetadata(track, { signal: controller.signal })), aborted])
        .then(value => {
          if (controller.signal.aborted || !this.targets.has(key)) return;
          this.remember(key, { value, until: this.now() + 6 * 3600000 });
          this.onMetadata(key, value);
        }).catch(() => {
          if (this.targets.has(key) && (!controller.signal.aborted || job.timedOut)) {
            this.remember(key, { until: this.now() + 600000 });
          }
        }).finally(() => {
          clearTimeout(timer);
          if (this.jobs.get(key) === job) this.jobs.delete(key);
          this.pump();
        });
    }
  }

  remember(key, value) {
    this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
  }

  dispose() {
    this.targets.clear();
    for (const job of this.jobs.values()) job.controller.abort();
    this.cache.clear();
  }
}
