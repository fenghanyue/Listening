import assert from 'node:assert/strict';
import { fetchQQMetadata, fetchQQDetails } from '../src/api/qq.js';
import { TrackMetadataLoader, metadataKey } from '../src/api/metadata.mjs';
import { RecommendationEngine, RECOMMENDATION_KEY } from '../src/api/recommendations.mjs';
import { createChecker } from './lib.mjs';

const {check, finish} = createChecker();
const song = id => ({source:'qq',qqId:String(id),songid:String(id),title:'Song '+id,artist:'Artist',cover:null,album:'',audioUrl:null,detailsLoaded:false});
const response = (id, suffix = '') => ({song_mid:String(id),song_title:'Song '+id,singer_name:'Artist',album_name:'Album',album_pic:'http://covers.example/'+id+'.jpg',song_h5_url:'https://y.qq.com/'+id,song_lyric:'[00:00.00]Line',song_play_url:'http://audio.example/'+id+suffix+'.mp3'});
const tick = () => new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch;
try {
  const requests = [];
  let release;
  globalThis.fetch = (url, options) => {
    requests.push({url,signal:options.signal});
    return new Promise(resolve => { release = data => resolve({ok:true,json:async()=>data}); });
  };
  const track = song('shared'), snapshot = JSON.stringify(track);
  const metadata = fetchQQMetadata(track), playing = fetchQQDetails({...track});
  assert.equal(requests.length,1);
  release(response('shared'));
  const [display, full] = await Promise.all([metadata, playing]);
  check('display and playback share one in-flight QQ query', requests.length===1&&!!display.cover&&!!full.audioUrl);
  check('display metadata leaves the input and playback fields untouched', JSON.stringify(track)===snapshot&&!('audioUrl' in display)&&!('detailsLoaded' in display)&&display.cover.startsWith('https://'));
  check('detail lookup makes no audio request', requests.every(r=>r.url.startsWith('https://tang.api.s01s.cn/')));
  const next = fetchQQDetails(track); release(response('shared','-fresh')); await next;
  check('playback obtains a fresh link after an earlier display query',requests.length===2&&track.audioUrl.endsWith('-fresh.mp3'));

  const controller = new AbortController();
  const first = fetchQQMetadata(song('cancel'),{signal:controller.signal});
  const second = fetchQQDetails(song('cancel'));
  const signal = requests.at(-1).signal;
  controller.abort();
  await assert.rejects(first);
  assert.equal(signal.aborted,false);
  release(response('cancel'));
  check('cancelling a display request preserves a concurrent playback consumer',!!(await second).audioUrl);
  const wrong = fetchQQMetadata(song('expected')); release(response('different'));
  await assert.rejects(wrong,/mismatched mid/);
  check('a mismatched QQ response cannot replace another song metadata',true);
} finally { globalThis.fetch = originalFetch; }

const pending = [], changes = [];
let clock = 1000000;
const loader = new TrackMetadataLoader({now:()=>clock,fetchMetadata:(track,{signal})=>new Promise((resolve,reject)=>{
  pending.push({track,signal,resolve,reject});
}),onMetadata:(key,value)=>changes.push({key,value})});
loader.update([song(1),song(1),song(2),song(3)]);
await tick();
check('visible-song queries are deduplicated and limited to two concurrent requests',pending.length===2&&loader.jobs.size===2);
pending[0].resolve({cover:'https://covers.example/1.jpg',album:'Album'});
await tick();
check('finishing one query allows the next visible song to load',pending.length===3);
loader.update([song(1),song(4)]);
check('leaving a view aborts queries that no longer have a visible consumer',pending[1].signal.aborted&&pending[2].signal.aborted);
await tick();
pending[1].resolve({cover:'stale'});pending[2].resolve({cover:'stale'});
await tick();
check('late responses from a previous view are discarded',!changes.some(c=>c.value.cover==='stale'));
check('another occurrence of the same song reuses cached metadata',pending.filter(p=>metadataKey(p.track)==='1').length===1&&changes.filter(c=>c.key==='1').length>=2);
const last=pending.at(-1);last.reject(new Error('unavailable'));await tick();
const failedCount=pending.length;
loader.update([song(4)]);await tick();
check('a failed lookup keeps its placeholder without a retry loop',pending.length===failedCount);
clock+=600001;loader.update([song(4)]);await tick();
check('a failed song can be retried after the cooldown',pending.length===failedCount+1);
loader.update([song(5)],{online:false});await tick();
check('offline mode cancels work and sends no new metadata queries',pending.at(-1).signal.aborted&&loader.jobs.size===0);
loader.dispose();

let timeoutCalls=0;
const timeoutLoader=new TrackMetadataLoader({timeout:5,fetchMetadata:()=>{timeoutCalls++;return new Promise(()=>{});},onMetadata:()=>assert.fail('timed-out query committed')});
timeoutLoader.update([song('timeout1'),song('timeout2'),song('timeout3')]);
for (let i=0;i<100 && (timeoutCalls<3 || timeoutLoader.jobs.size);i++) await new Promise(resolve=>setTimeout(resolve,5));
check('timeouts release slots even when an upstream lookup ignores cancellation',timeoutCalls===3&&timeoutLoader.jobs.size===0);
timeoutLoader.dispose();

const data=new Map([[RECOMMENDATION_KEY,JSON.stringify({basic:{tracks:[song('persisted')],at:Date.now()}})]]);
const engine=new RecommendationEngine({storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}});
engine.updateMetadata({...song('persisted'),cover:'https://covers.example/persisted.jpg',album:'Album',pageUrl:'https://y.qq.com/persisted',audioUrl:'secret-expiring-audio',lrc:'lyrics-not-for-recommendation-cache'});
const saved=data.get(RECOMMENDATION_KEY);
check('recommendation cache keeps enriched display fields without audio URLs or lyrics',JSON.parse(saved).basic.tracks[0].cover.endsWith('persisted.jpg')&&!saved.includes('secret-expiring-audio')&&!saved.includes('lyrics-not-for-recommendation-cache'));
process.exit(finish());
