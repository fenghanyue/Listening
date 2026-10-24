// 固定版本的原生插件把 0 倍速改成 1，且相同位置不刷新时间戳：缓冲时车机可能继续推算进度。
// 每次 cap sync 前应用这两个小修正，不升级依赖。识别不到源码时停止构建，避免静默漏修。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function replaceOnce(source, before, after) {
  if (source.split(after).length === 2 && !source.includes(before)) return source;
  if (source.split(before).length !== 2 || source.includes(after)) {
    throw new Error('MediaSession 原生源码与预期不符，请检查插件版本和进度修正');
  }
  return source.replace(before, after);
}

export function patchMediaSessionSources(plugin, service) {
  return {
    plugin: replaceOnce(plugin,
      'float playbackSpeed = playbackRate == 0.0 ? 1.0F : (float) playbackRate;',
      'float playbackSpeed = (float) playbackRate;'),
    service: replaceOnce(service,
      `    public void setPosition(long newPosition) {
        if (position != newPosition) {
            position = newPosition;
            playbackStateUpdate = true;
        }
    }`,
      `    public void setPosition(long newPosition) {
        // 相同位置也是一次校准：以本次上报时间为基准，不能沿用旧时间戳继续推算。
        position = newPosition;
        playbackStateUpdate = true;
    }`),
  };
}

async function main() {
  const root = fileURLToPath(new URL('../node_modules/@capgo/capacitor-media-session/', import.meta.url));
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== '8.0.32') throw new Error(`MediaSession ${pkg.version} 未验证，请检查原生进度修正`);
  const dir = path.join(root, 'android/src/main/java/com/capgo/mediasession');
  const pluginPath = path.join(dir, 'MediaSessionPlugin.java');
  const servicePath = path.join(dir, 'MediaSessionService.java');
  const [plugin, service] = await Promise.all([fs.readFile(pluginPath, 'utf8'), fs.readFile(servicePath, 'utf8')]);
  const patched = patchMediaSessionSources(plugin, service);
  if (plugin !== patched.plugin) await fs.writeFile(pluginPath, patched.plugin);
  if (service !== patched.service) await fs.writeFile(servicePath, patched.service);
  console.log('MediaSession 原生进度修正已就绪（0 倍速、位置校准时间戳）');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
