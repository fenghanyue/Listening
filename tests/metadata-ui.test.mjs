// 真实页面 + 可控 QQ 响应：浏览只补资料，播放和下一首预下载仍独立工作。
import fs from 'node:fs/promises';
import {BASE,OUT,launchBrowser,logicDriver,seedRecommendationCache,createChecker} from './lib.mjs';

const {check,finish}=createChecker();
const browser=await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const song=(mid,id)=>({id,uid:'qq-'+mid,source:'qq',songid:mid,qqId:mid,songMid:mid,title:'Song '+mid,artist:'Artist',album:'',cover:null,audioUrl:null,detailsLoaded:false});
const recs=Array.from({length:24},(_,i)=>song('rec'+i));
const library=[song('rec0',101),song('current',200),...Array.from({length:80},(_,i)=>song('long'+i,1000+i))];
const persisted={queue:library,playOrder:[200,101],currentId:200,playlists:[{id:'liked',name:'喜欢的音乐',builtin:true},{id:'long',name:'Long playlist',trackIds:library.slice(2).map(t=>t.id)}],liked:{},likedOrder:[]};
const audio=Buffer.alloc(8044,128);audio.write('RIFF');audio.writeUInt32LE(8036,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);audio.write('data',36);audio.writeUInt32LE(8000,40);
const counts={details:[],searches:[],audio:[],images:[]},errors=[];
let releaseHome,releaseLate;
let homeGate=new Promise(resolve=>releaseHome=resolve);

async function routeRequest(route) {
  const u=new URL(route.request().url());
  if(u.hostname==='tang.api.s01s.cn') {
    const mid=u.searchParams.get('mid'),keyword=u.searchParams.get('msg');
    if(!mid) {
      counts.searches.push(keyword);
      const ids=keyword==='late A'?['lateA']:keyword==='late B'?['lateB']:['rec0','search1'];
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(ids.map(id=>({song_mid:id,song_title:'Song '+id,singer_name:'Artist'})))});
    }
    counts.details.push(mid);
    if(homeGate) await homeGate;
    if(mid==='lateA') await new Promise(resolve=>releaseLate=resolve);
    await new Promise(resolve=>setTimeout(resolve,15));
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({song_mid:mid,song_title:'Song '+mid,singer_name:'Artist',album_name:'Album '+mid,
      album_pic:'http://covers.example/'+mid+'.png',song_h5_url:'https://y.qq.com/song/'+mid,song_lyric:'[00:00.00]Line '+mid,
      song_play_url:'https://audio.example/'+mid+'-'+counts.details.filter(id=>id===mid).length+'.wav'})}).catch(()=>{});
  }
  if(u.hostname==='covers.example') {counts.images.push(u.href);return route.fulfill({status:200,contentType:'image/png',body:PNG});}
  if(u.hostname==='audio.example') {counts.audio.push(u.href);return route.fulfill({status:200,contentType:'audio/wav',body:audio});}
  if(u.origin!==new URL(BASE).origin || /^\/(proxy|stream|sc-client-id)/.test(u.pathname)) return route.abort();
  return route.continue();
}

async function context(native=false) {
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await seedRecommendationCache(ctx,recs);
  await ctx.addInitScript(data=>{if(!localStorage.getItem('listening-player-library-v1'))localStorage.setItem('listening-player-library-v1',JSON.stringify(data));},persisted);
  if(native) await ctx.addInitScript(png=>{
    window.__metadataNative=[];
    window.Capacitor={isNativePlatform:()=>true,PluginHeaders:[{name:'MediaSession'},{name:'CapacitorHttp'}],nativeCallback:()=> 'callback',nativePromise:(plugin,method,options)=>{
      window.__metadataNative.push({plugin,method,options});
      return Promise.resolve(plugin==='CapacitorHttp'?{status:200,headers:{'Content-Type':'image/png'},data:png}:{});
    }};
  },PNG.toString('base64'));
  await ctx.route('**/*',routeRequest);
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(BASE,{waitUntil:'load'});await page.waitForSelector('.sw-rec-featured');
  return {ctx,page,L:logicDriver(page)};
}

const {ctx,page,L}=await context();
check('recommendation names appear while display-detail responses are still pending',await page.locator('.sw-rec-featured').count()===12&&await L(`return logic.state.recommendations.every(t=>!t.cover);`));
for(let i=0;i<100&&counts.details.length<2;i++) await page.waitForTimeout(10);
check('the page starts at most two display-detail lookups at once',counts.details.length===2);
homeGate=null;releaseHome();
await page.waitForFunction(()=>document.querySelector('.sw-rec-art')?.style.backgroundImage.includes('covers.example'));
await page.waitForFunction(()=>document.querySelector('.dc-mobile-miniplayer .sw-cover')?.style.backgroundImage.includes('current.png'));
check('recommendation and restored paused-current covers load without playing',await L(`return !!logic.state.recommendations[0].cover&&!!logic.state.queue.find(t=>t.id===200).cover&&!logic.state.playing;`)&&counts.audio.length===0);
check('another copy in the library shares the same song metadata',await L(`return logic.state.queue.find(t=>t.id===101).album==='Album rec0';`)&&counts.details.filter(id=>id==='rec0').length===1);
const initialCache=await page.evaluate(()=>({rec:localStorage.getItem('listening-recommendations-v1'),lib:localStorage.getItem('listening-player-library-v1')}));
check('display metadata is persisted without preparing or storing an audio link',initialCache.rec.includes('covers.example/rec0.png')&&!initialCache.rec.includes('audio.example')&&!initialCache.lib.includes('audio.example')&&await L(`return logic.state.recommendations.every(t=>!t.audioUrl&&!t.detailsLoaded);`));
check('offscreen candidates and unopened large playlists are not queried',!counts.details.some(id=>/^long/.test(id)||id==='rec23'));

await L(`logic.patch({sources:{netease:false,qq:true},searchQuery:'shared'});`);await L(`logic.doSearch();`);
await page.waitForSelector('.dc-result-row');
await page.waitForFunction(()=>document.querySelector('.dc-result-row .sw-cover')?.style.backgroundImage.includes('rec0.png'));
check('formal search reuses metadata already loaded on the recommendation home',counts.details.filter(id=>id==='rec0').length===1&&await L(`return logic.state.searchResults[0].album==='Album rec0';`));
await page.waitForFunction(()=>[...document.querySelectorAll('.dc-result-row .sw-cover')].every(e=>e.style.backgroundImage.includes('covers.example')));
check('new QQ search results receive covers without audio downloads',counts.details.includes('search1')&&counts.audio.length===0);

const beforeReload=counts.details.filter(id=>id==='rec0').length;
await page.reload({waitUntil:'load'});await page.waitForSelector('.sw-rec-featured');
await L(`logic.patch({sources:{netease:false,qq:true},searchQuery:'shared'});`);await L(`logic.doSearch();`);
await page.waitForFunction(()=>document.querySelector('.dc-result-row .sw-cover')?.style.backgroundImage.includes('rec0.png'));
check('a fresh search after reload reuses persisted library metadata',counts.details.filter(id=>id==='rec0').length===beforeReload);

await L(`logic.patch({searchQuery:'late A'});`);await L(`logic.doSearch();`);
for(let i=0;i<200&&!releaseLate;i++) await page.waitForTimeout(10);
check('a slow metadata query began for the previous search',!!releaseLate);
await L(`logic.patch({searchQuery:'late B'});`);await L(`logic.doSearch();`);
await page.waitForFunction(()=>document.querySelector('.dc-result-row .sw-cover')?.style.backgroundImage.includes('lateB.png'));
releaseLate();await page.waitForTimeout(50);
check('late details cannot replace a newer search result',await L(`return logic.state.appliedQuery==='late B'&&logic.state.searchResults.length===1&&logic.state.searchResults[0].title==='Song lateB'&&logic.state.searchResults[0].cover.endsWith('lateB.png');`));

await L(`logic.selectPlaylist('long');`);
await page.waitForFunction(()=>document.querySelector('.dc-result-row .sw-cover')?.style.backgroundImage.includes('long0.png'));
check('old playlist entries gain covers while a large playlist loads only visible rows',counts.details.some(id=>id==='long0')&&!counts.details.includes('long79')&&counts.details.filter(id=>/^long/.test(id)).length<25);
await page.locator('.sw-main').evaluate(el=>el.scrollTop=el.scrollHeight);
await page.waitForFunction(()=>[...document.querySelectorAll('.dc-result-row .sw-cover')].some(e=>e.style.backgroundImage.includes('long79.png')));
check('scrolling loads metadata for newly visible playlist rows',counts.details.includes('long79'));
await L(`const t={id:5000,uid:'qq-imported',source:'qq',songid:'imported',qqId:'imported',title:'Imported',artist:'Artist'};logic.applyImportedTracks([t],'Imported playlist');logic.selectPlaylist(logic.state.playlists.find(p=>p.name==='Imported playlist').id);`);
await page.locator('.sw-main').evaluate(el=>el.scrollTop=0);
await page.waitForFunction(()=>document.querySelector('.dc-result-row .sw-cover')?.style.backgroundImage.includes('imported.png'));
check('imported QQ songs use the same metadata enrichment',counts.details.includes('imported')&&counts.audio.length===0);

await L(`const t={id:6000,uid:'qq-queue-only',source:'qq',songid:'queue-only',qqId:'queue-only',title:'Queued song',artist:'Artist'};logic.patch({queue:[...logic.state.queue,t],playOrder:[200,6000],mobileNowPlayingExpanded:true});logic.setMediaView('queue');`);
await page.waitForFunction(()=>[...document.querySelectorAll('.sw-queue .sw-cover')].some(e=>e.style.backgroundImage.includes('queue-only.png')));
check('opening the playback queue fills missing QQ covers without starting audio',counts.details.includes('queue-only')&&counts.audio.length===0);

await page.evaluate(()=>Promise.all([
  new Promise((resolve,reject)=>{const r=indexedDB.open('listening-audio-cache',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('tracks','readwrite');tx.objectStore('tracks').put({id:'qq:cached',blob:new Blob([new Uint8Array(1234)],{type:'audio/mpeg'}),size:1234,lastAccessed:Date.now()});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}),
  new Promise((resolve,reject)=>{const r=indexedDB.open('listening-audio-meta',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({id:'qq:cached',meta:{source:'qq',songid:'cached',qqId:'cached',title:'Cached song',artist:'Artist'},coverBlob:null});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}),
]));
await L(`logic.patch({mobileNowPlayingExpanded:false});return logic.refreshCacheIndex();`);await L(`logic.selectPlaylist('__cached');`);
await page.waitForFunction(()=>document.querySelector('.dc-result-row .sw-cover')?.style.backgroundImage.includes('cached.png'));
const cached=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('listening-audio-cache',1);r.onsuccess=()=>{const db=r.result,q=db.transaction('tracks').objectStore('tracks').get('qq:cached');q.onsuccess=()=>{resolve({size:q.result?.size});db.close();};};}));
check('cached songs missing a cover URL receive metadata while their audio stays intact',cached.size===1234&&counts.audio.length===0);

await L(`logic.toggleOfflineOnly();logic.patch({queue:[...logic.state.queue,{id:8000,source:'qq',qqId:'offline',songid:'offline',title:'Offline',artist:'Artist'}],playOrder:[8000],currentId:8000});`);
await page.waitForTimeout(80);
check('offline-only browsing does not request missing song details',!counts.details.includes('offline'));
await L(`logic.toggleOfflineOnly();`);
await page.waitForFunction(()=>document.querySelector('.dc-mobile-miniplayer .sw-cover')?.style.backgroundImage.includes('offline.png'));

await L(`logic.patch({currentId:200,playOrder:[200,6000]});`);
const beforePrefetch=counts.audio.length;
await L(`return logic.prefetchTrack(logic.state.queue.find(t=>t.id===6000));`);
for(let i=0;i<200&&counts.audio.length===beforePrefetch;i++) await page.waitForTimeout(10);
check('next-track prefetch still downloads audio before the song starts',counts.audio.length>beforePrefetch&&await L(`return !logic.state.playing;`));
const beforePlayback=counts.details.filter(id=>id==='current').length;
await L(`logic.startTrack(logic.state.queue.find(t=>t.id===200));`);
await page.waitForFunction(()=>document.getElementById('player-audio').currentTime>0);
check('playback obtains a fresh QQ link and starts real audio',counts.details.filter(id=>id==='current').length>beforePlayback&&counts.audio.some(url=>url.includes('/current-')));
await L(`logic._audio.pause();logic.closeMobileNowPlaying();logic.cancelSearch();logic.setPage('search');`);
await page.locator('.sw-main').evaluate(el=>el.scrollTop=0);
await page.screenshot({path:OUT+'/qq-metadata-home.png'});
await ctx.close();

const aiCtx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await aiCtx.route('**/*',routeRequest);
await aiCtx.addInitScript(track=>{
  const config={enabled:true,auto:false,baseUrl:'https://model.example/v1',model:'test',revision:'metadata-test',apiKey:'dummy-test-key'};
  localStorage.setItem('listening-ai-config-v1',JSON.stringify(config));
  localStorage.setItem('listening-recommendations-v1',JSON.stringify({basic:{tracks:[],at:Date.now(),lastAttempt:Date.now()},ai:{tracks:[track],at:Date.now(),tag:[config.baseUrl,config.model,config.revision].join('|')}}));
},song('ai-only'));
const aiPage=await aiCtx.newPage();aiPage.on('pageerror',e=>errors.push(String(e)));await aiPage.goto(BASE);
await aiPage.waitForFunction(()=>document.querySelector('.sw-rec-art')?.style.backgroundImage.includes('ai-only.png'));
check('AI recommendations enrich and persist QQ metadata without model calls',await logicDriver(aiPage)(`return logic.state.recommendationKind==='ai'&&JSON.parse(localStorage.getItem(ListeningAPI.RECOMMENDATION_KEY)).ai.tracks[0].cover.endsWith('ai-only.png');`));
await aiCtx.close();

const native=await context(true);
await native.page.waitForFunction(()=>window.__metadataNative.some(c=>c.method==='setMetadata'&&c.options.artwork?.some(a=>a.src.startsWith('data:image/'))));
check('mock APK synchronizes the enriched paused song to the media session',await native.L(`return logic.state.queue.find(t=>t.id===200).album==='Album current'&&!logic.state.playing;`));
await native.ctx.close();
check('metadata browsing and playback finish without page errors',errors.length===0,errors);
await fs.writeFile(OUT+'/qq-metadata-ui-requests.json',JSON.stringify(counts,null,2));
await browser.close();process.exit(finish());
