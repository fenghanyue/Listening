import fs from 'node:fs/promises';
import {BASE,OUT,launchBrowser,logicDriver,createChecker} from './lib.mjs';

const {check,finish}=createChecker();
const browser=await launchBrowser();
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const items=Array.from({length:48},(_,i)=>({name:'Sample song '+(i+1),artist:'Sample Artist '+(i%8+1),url:'https://api.qijieya.cn/meting/?type=url&id='+(90001+i),pic:'https://covers.example/'+i+'.png',lrc:null}));
const candidates=items.slice(12,44).map(t=>({title:t.name,artist:t.artist}));
const musicRequests=[],aiRequests=[],errors=[];
let aiMode='ok',releaseLate;
async function routeRequests(route) {
  const url=new URL(route.request().url());
  if(url.hostname==='covers.example') return route.fulfill({status:200,contentType:'image/png',body:PNG});
  if(url.hostname==='api.qijieya.cn') {
    const type=url.searchParams.get('type'),keyword=url.searchParams.get('id')||'';
    musicRequests.push({type,keyword});
    const list=type==='playlist'?items:items.filter(t=>(t.name+' '+t.artist).toLowerCase().includes(keyword.toLowerCase()));
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(list)});
  }
  if(url.hostname==='tang.api.s01s.cn') {
    musicRequests.push({type:'qq',keyword:url.searchParams.get('msg')});
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  }
  if(url.origin===new URL(BASE).origin && url.pathname==='/recommendations/ai') {
    const body=route.request().postDataJSON();aiRequests.push(body);
    if(aiMode==='late') await new Promise(resolve=>releaseLate=resolve);
    if(aiMode==='auth') return route.fulfill({status:401,contentType:'application/json',body:'{"error":"AI_AUTH"}'});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body.mode==='test'?{ok:true}:{songs:candidates})}).catch(()=>{});
  }
  if(url.origin!==new URL(BASE).origin || /^\/(proxy|stream|sc-client-id)/.test(url.pathname)) return route.abort();
  return route.continue();
}

const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
await ctx.route('**/*',routeRequests);
const page=await ctx.newPage();page.on('pageerror',error=>errors.push(String(error)));
await page.goto(BASE,{waitUntil:'load'});await page.waitForSelector('.sw-rec-featured');await page.evaluate(()=>document.fonts.ready);
const L=logicDriver(page);
await L(`logic.ensureLyricsForCurrent=()=>{};logic.prefetchTrack=()=>{};`);
check('default page displays one recommendation grid with no artificial groups',await page.locator('.sw-rec-grid').count()===1&&await page.locator('.sw-rec-featured').count()===12&&!(await page.locator('.dc-app-shell').innerText()).match(/为你精选|接着听|从你喜欢的音乐里/));
check('source selection stays hidden on the recommendation home',await page.locator('.sw-filters').count()===0);
const firstBatch=await L(`return logic.state.recommendations.map(t=>t.uid);`);
const playlistCalls=musicRequests.filter(r=>r.type==='playlist').length;
await page.locator('.sw-rec-tools button').last().click();
const secondBatch=await L(`return logic.state.recommendations.map(t=>t.uid);`);
check('refresh picks rotates the cached songs without fetching or calling a model',secondBatch.every(uid=>!firstBatch.includes(uid))&&musicRequests.filter(r=>r.type==='playlist').length===playlistCalls&&aiRequests.length===0);

await page.locator('.dc-search-input').click();
await page.waitForSelector('.sw-filters');
check('tapping the empty search field reveals sources before any search',await page.locator('.sw-rec-grid').count()===0&&await page.locator('.dc-result-row').count()===0&&await page.locator('.sw-filters button').count()===2);
await page.locator('.sw-filters button').nth(1).click();
await page.locator('.dc-search-input').fill('Sample Artist 1');await page.locator('.sw-search-btn').click();
await page.waitForSelector('.dc-result-row');
check('search queries only the selected source',musicRequests.some(r=>r.type==='search'&&r.keyword==='Sample Artist 1')&&!musicRequests.some(r=>r.type==='qq'&&r.keyword==='Sample Artist 1'));
await page.locator('.sw-search-clear').click();
check('clearing the query preserves search mode and the selected source',await L(`return logic.state.searchMode&&!logic.state.hasSearched&&logic.state.sources.netease&&!logic.state.sources.qq;`));
await page.locator('.sw-search-cancel').click();await page.waitForSelector('.sw-rec-grid');
check('cancel returns to the recommendation home',await page.locator('.sw-filters').count()===0);

const likedId=await L(`return logic.state.recommendations[0].id;`);
await page.locator('.sw-rec-featured .sw-icon-btn').first().click();await page.locator('.sw-rec-menu button').nth(0).click();
check('liking a recommendation keeps it in the library and favorites',await L(`return !!logic.state.liked[arg]&&logic.state.queue.some(t=>t.id===arg);`,likedId));
await page.locator('.sw-rec-featured .sw-icon-btn').first().click();await page.locator('.sw-rec-menu button').nth(1).click();
check('recommendation menu uses the existing add-to-playlist sheet',await page.locator('.dc-modal-overlay').count()===1);
await L(`logic.closeAddModal();`);
const dismissed=await L(`return ListeningAPI.recommendationKey(logic.state.recommendations[0]);`);
await page.locator('.sw-rec-featured .sw-icon-btn').first().click();await page.locator('.sw-rec-menu button').nth(2).click();
check('not interested hides a recommendation immediately',await L(`return !logic.state.recommendations.some(t=>ListeningAPI.recommendationKey(t)===arg);`,dismissed));
await page.reload({waitUntil:'load'});await page.waitForSelector('.sw-rec-featured');
check('cached recommendations and dismissed songs persist across reload',musicRequests.filter(r=>r.type==='playlist').length===playlistCalls&&await L(`return !logic.state.recommendations.some(t=>ListeningAPI.recommendationKey(t)===arg);`,dismissed));

await L(`logic.ensureLyricsForCurrent=()=>{};logic.prefetchTrack=()=>{};logic.startTrack=t=>{logic._playedTrackId=t.id;logic.patch({currentId:t.id});};`);
await page.locator('.sw-rec-tools button').first().click();
check('play all replaces the playback queue while preserving the library',await L(`return logic.state.playOrder.length===logic.state.recommendations.length&&logic._playedTrackId===logic.state.recommendations[0].id&&logic.state.queue.some(t=>logic.state.liked[t.id]);`));
const metrics=await L(`
  const a={currentTime:0,paused:false,seeking:false,duration:240,playbackRate:1};
  logic._mediaBuffering=false;logic._listenSession=null;
  for(let i=0;i<=31;i++){a.currentTime=i;logic.observeListening(a);}
  const track=logic.state.queue.find(t=>t.id===logic.state.currentId);
  const before=logic._listenSession.seconds;
  a.currentTime=200;logic.observeListening(a);
  const afterSeek=logic._listenSession.seconds;
  a.paused=true;a.currentTime=202;logic.observeListening(a);
  return {plays:logic._recommendationEngine.store.history[ListeningAPI.recommendationKey(track)].plays,before,afterSeek,afterPause:logic._listenSession.seconds};
`);
check('listening metrics require actual progress and ignore pauses and large seeks',metrics.plays===1&&metrics.before===metrics.afterSeek&&metrics.before===metrics.afterPause);
await L(`logic.finishListening();`);

await page.locator('.sw-nav button').nth(2).click();
check('AI key is masked by default',await page.locator('#ai-api-key').getAttribute('type')==='password');
await page.locator('#ai-base-url').fill('https://example.com/v1');await page.locator('#ai-api-key').fill('test-device-secret');await page.locator('#ai-model').fill('test-model');
await page.getByRole('button',{name:'测试连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sw-ai-status')?.textContent==='连接正常');
check('connection test uses a short request without uploading the music library',aiRequests.at(-1).mode==='test'&&!aiRequests.at(-1).profile);
await page.locator('.sw-ai-settings [role="switch"]').first().click();await page.getByRole('button',{name:'保存设置',exact:true}).click();
await page.waitForFunction(()=>{
  const el=document.querySelector('.dc-app-shell'),key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=el[key];while(f&&!(f.stateNode?.logic?.renderVals))f=f.return;return f.stateNode.logic.state.recommendationKind==='ai'&&!f.stateNode.logic.state.aiBusy;
});
check('saving enabled AI settings generates and verifies a cached batch',aiRequests.filter(r=>r.mode==='recommend').length===1&&await L(`return logic.state.recommendations.every(t=>!!t.songid)&&logic.state.recommendationKind==='ai';`));
const credentialIsolation=await page.evaluate(()=>({cache:localStorage.getItem('listening-recommendations-v1')||'',library:localStorage.getItem('listening-player-library-v1')||'',diag:localStorage.getItem('listening-diag-log-v1')||''}));
check('AI credentials stay out of recommendation, library and diagnostics storage',Object.values(credentialIsolation).every(value=>!value.includes('test-device-secret'))&&aiRequests.every(r=>!JSON.stringify(r).includes('test-device-secret')));
await page.locator('.sw-nav button').first().click();await page.waitForSelector('.sw-rec-ai');
const beforeRefresh=aiRequests.length;await page.locator('.sw-rec-tools button').last().click();
await page.waitForFunction(()=>{
  const el=document.querySelector('.dc-app-shell'),key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=el[key];while(f&&!(f.stateNode?.logic?.renderVals))f=f.return;return !f.stateNode.logic._recommendationEngine.resolving;
});
check('AI refresh picks resolves existing names without another model request',aiRequests.length===beforeRefresh);

await page.locator('.sw-nav button').nth(2).click();aiMode='auth';
await page.locator('#ai-api-key').fill('invalid-test-key');await page.getByRole('button',{name:'保存设置',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('.sw-ai-status')?.textContent.includes('Key 无效'));
check('an invalid AI key falls back to basic picks and shows an actionable settings error',await L(`return logic.state.recommendationKind==='basic'&&logic.state.recommendations.length>0&&!logic.state.aiBusy;`));
aiMode='late';await page.locator('#ai-api-key').fill('replacement-test-key');await page.getByRole('button',{name:'保存设置',exact:true}).click();
for(let i=0;i<100&&!releaseLate;i++) await page.waitForTimeout(10);
check('new model request began for the changed configuration',!!releaseLate);
await page.getByRole('button',{name:'清除 AI 配置',exact:true}).click();releaseLate?.();aiMode='ok';
await page.waitForTimeout(80);
check('clearing credentials cancels outstanding generation and keeps basic recommendations',await L(`return !logic.state.aiConfig.enabled&&!logic.state.aiConfig.apiKey&&!logic.state.aiBusy&&logic.state.recommendationKind==='basic'&&localStorage.getItem(ListeningAPI.AI_CONFIG_KEY)===null;`));

const layouts=[];
for(const lang of ['zh','en']) {
  await L(`logic.setLang(arg);`,lang);
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:844});
    for(const target of ['home','settings']) {
      await L(`logic.cancelSearch();logic.setPage(arg==='home'?'search':'settings');`,target);
      await page.waitForTimeout(20);
      const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,bad:[...document.querySelectorAll('.dc-app-shell button,.dc-app-shell input')].filter(el=>el.offsetParent!==null).filter(el=>{const r=el.getBoundingClientRect();return r.left < -1 || r.right>innerWidth+1;}).map(el=>el.className)}));
      layouts.push({lang,width,target,...result});
    }
  }
}
check('home and settings fit narrow phones, tablets and desktop in both languages',layouts.every(r=>r.overflow===0&&r.bad.length===0),layouts.filter(r=>r.overflow||r.bad.length));
await page.setViewportSize({width:390,height:844});await L(`logic.setLang('zh');logic.cancelSearch();logic.setPage('search');`);
await page.locator('.sw-main').evaluate(el=>el.scrollTop=0);
await page.waitForTimeout(400); // Let the existing desktop-to-phone player transition finish.
await page.screenshot({path:OUT+'/recommendations-home.png'});
await page.locator('.dc-search-input').click();await page.screenshot({path:OUT+'/recommendations-search.png'});
await L(`logic.setPage('settings');`);await page.locator('.sw-main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:OUT+'/recommendations-settings.png'});

// Capacitor's native HTTP path must work without the web relay or a global fetch override.
const nativeCtx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await nativeCtx.route('**/*',routeRequests);
await nativeCtx.addInitScript(()=>{
  window.__nativeAIRequests=[];
  window.Capacitor={isNativePlatform:()=>true,PluginHeaders:[{name:'CapacitorHttp'}],nativePromise:(plugin,method,options)=>{
    if(plugin==='CapacitorHttp') {window.__nativeAIRequests.push(options);return Promise.resolve({status:200,data:{choices:[{message:{content:'OK'}}]}});}
    return Promise.resolve({});
  }};
});
const native=await nativeCtx.newPage();native.on('pageerror',error=>errors.push(String(error)));await native.goto(BASE);await native.waitForSelector('.dc-app-shell');
const relaysBeforeNative=aiRequests.length;
const nativeResult=await logicDriver(native)(`return (async()=>{const result=await logic.requestAIRecommendations({baseUrl:'https://example.com/v1',apiKey:'native-test-key',model:'test-model'},{mode:'test',signal:new AbortController().signal});return {result,request:window.__nativeAIRequests.at(-1)};})();`);
check('APK calls the configured model with native HTTP and redirects disabled',nativeResult.result.ok&&nativeResult.request.method==='POST'&&nativeResult.request.disableRedirects===true&&nativeResult.request.data.max_tokens===8&&aiRequests.length===relaysBeforeNative);
check('all recommendation UI flows finish without page errors',errors.length===0,errors);
await fs.writeFile(OUT+'/recommendations-ui-layout.json',JSON.stringify(layouts,null,2));
await nativeCtx.close();await ctx.close();await browser.close();
process.exit(finish());
