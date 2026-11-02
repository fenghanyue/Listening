import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createChecker } from './lib.mjs';
import {
  RecommendationEngine, RECOMMENDATION_KEY, DAY, normalizeAIConfig, recommendationKey,
  matchRecommendedSong, buildAIRequest, parseAIResponse, aiEndpoint,
} from '../src/api/recommendations.mjs';
import { createAIHandler, isPublicAddress, resolvePublicEndpoint } from '../server/ai-recommendations.mjs';

const {check,finish}=createChecker();
const song=(n,artist='Artist '+n%8)=>({uid:'netease-'+n,source:'netease',songid:String(n),title:'Song '+n,artist,cover:'https://example.com/'+n+'.jpg'});
const songs=Array.from({length:60},(_,i)=>song(i+1));
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),data};};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async fn=>{for(let i=0;i<200&&!fn();i++) await sleep(2);assert.ok(fn());};
const rejectsCode=async(fn,code)=>{await assert.rejects(fn,error=>error.message===code);};

check('song matching rejects covers and different performers',
  matchRecommendedSong({title:'Song 1',artist:'Artist 1'},[song(1,'Cover singer'),{...song(1),title:'Song 1 (Live)'}])===null);
check('song matching accepts original titles and multiple credited performers',
  !!matchRecommendedSong({title:'Song 1',artist:'Artist 1'},[{...song(1),artist:'Artist 1 / Guest'}]));
check('cross-source duplicate song identities match',recommendationKey(song(1))===recommendationKey({...song(1),source:'qq',songid:'mid'}));
const request=buildAIRequest({model:'test-model',profile:{liked:[{...song(1),apiKey:'must-not-leak',lrc:'private lyrics'}],queue:songs,apiKey:'must-not-leak'}});
check('model context contains only bounded music summaries',!JSON.stringify(request).includes('must-not-leak')&&!JSON.stringify(request).includes('private lyrics')&&request.max_tokens===2400);
const modelResult=songs=>({choices:[{message:{content:JSON.stringify({songs})}}]});
check('model response parsing deduplicates and caps a batch',parseAIResponse(modelResult([...songs,songs[0]])).songs.length===50);
await rejectsCode(async()=>parseAIResponse({choices:[{message:{content:'not JSON'}}]}),'AI_BAD_RESPONSE');
check('invalid model JSON fails with a safe error',true);
for(const url of ['http://example.com/v1','https://user:password@example.com/v1','https://example.com/v1?api_key=x','https://example.com:8080/v1']) await rejectsCode(async()=>aiEndpoint(url),'AI_ENDPOINT');
check('only credential-free HTTPS base URLs are accepted',aiEndpoint('https://example.com/v1/').pathname==='/v1/chat/completions');

let clock=Date.UTC(2026,10,1),config=normalizeAIConfig(),snapshot,modelCalls=0,playlistCalls=0;
const storage=memory();
const context={queue:[],liked:[],playlisted:[],offline:false,isCached:t=>t.songid==='2'};
const engine=new RecommendationEngine({storage,now:()=>clock,config:()=>config,context:()=>context,
  search:async()=>[],playlist:async()=>{playlistCalls++;return songs;},requestAI:async()=>{modelCalls++;},onChange:value=>snapshot=value});
await engine.start();
check('new users receive a full basic batch without model configuration',snapshot.kind==='basic'&&snapshot.tracks.length===12&&playlistCalls===1&&modelCalls===0);
const first=new Set(snapshot.tracks.map(recommendationKey));
await engine.next();
check('refresh picks uses another cached batch without API calls',snapshot.tracks.every(t=>!first.has(recommendationKey(t)))&&playlistCalls===1&&modelCalls===0);
const hidden=snapshot.tracks[0];engine.dismiss(hidden);
check('not interested removes a song immediately',!snapshot.tracks.some(t=>recommendationKey(t)===recommendationKey(hidden)));
const reloaded=new RecommendationEngine({storage,now:()=>clock,config:()=>config,context:()=>context,search:async()=>[],playlist:async()=>{playlistCalls++;return [];},requestAI:async()=>{modelCalls++;},onChange:value=>snapshot=value});
await reloaded.start();
check('recommendation and dismissal caches survive reload without refetching',playlistCalls===1&&!snapshot.tracks.some(t=>recommendationKey(t)===recommendationKey(hidden)));
context.liked=[snapshot.tracks[0]];reloaded.emit();
check('already liked songs are excluded from online discovery',!snapshot.tracks.some(t=>recommendationKey(t)===recommendationKey(context.liked[0])));
context.queue=[song(1),song(2)];context.liked=[song(2)];context.offline=true;reloaded.emit();
check('offline discovery includes only cached songs, including cached favorites',snapshot.tracks.length===1&&snapshot.tracks[0].songid==='2'&&modelCalls===0);
reloaded.recordListening(song(2),31,{play:true});reloaded.recordListening(song(1),6,{skip:true});
check('effective listening and manual early skips are recorded separately',reloaded.store.history[recommendationKey(song(2))].plays===1&&reloaded.store.history[recommendationKey(song(1))].skips===1);

config=normalizeAIConfig({enabled:true,auto:true,baseUrl:'https://example.com/v1',apiKey:'test-secret-do-not-print',model:'test-model',revision:'first'});
const aiStorage=memory();let aiSnapshot,active=0,maxActive=0,queries=[];
const ai=new RecommendationEngine({storage:aiStorage,now:()=>clock,config:()=>config,context:()=>({...context,offline:false,liked:[],queue:[]}),
  playlist:async()=>songs,search:async options=>{active++;maxActive=Math.max(maxActive,active);queries.push(options);await sleep(2);active--;return songs.filter(t=>`${t.title} ${t.artist}`===options.keyword);},
  requestAI:async()=>{modelCalls++;return {songs:songs.slice(0,30)};},onChange:value=>aiSnapshot=value});
await ai.start();
check('AI names are resolved through music search before display',aiSnapshot.kind==='ai'&&aiSnapshot.tracks.length===12&&queries.length>=12);
check('song verification concurrency is bounded',maxActive===2);
const callsAfterGeneration=modelCalls;
await ai.next();await until(()=>!ai.resolving);await ai.maybeGenerate();
check('next batch and repeat startup do not call the model again',modelCalls===callsAfterGeneration);
check('API key never enters the recommendation cache',!aiStorage.getItem(RECOMMENDATION_KEY).includes(config.apiKey));
const savedCandidateCount=ai.store.ai.candidates.length;
const resumed=new RecommendationEngine({storage:aiStorage,now:()=>clock,config:()=>({...config,auto:false}),context:()=>({...context,offline:false,liked:[],queue:[]}),playlist:async()=>songs,
  search:async options=>songs.filter(t=>`${t.title} ${t.artist}`===options.keyword),requestAI:async()=>{throw new Error('Model must not be called');},onChange:()=>{}});
await resumed.start();
check('cached unresolved names resume after reload even when automatic model generation is off',savedCandidateCount>0&&resumed.store.ai.candidates.length<savedCandidateCount&&resumed.store.ai.tracks.length>ai.store.ai.tracks.length);
resumed.cancel();
clock+=DAY+1;ai.store.ai.tracks=ai.store.ai.tracks.slice(0,12);ai.store.ai.candidates=[];
await ai.maybeGenerate();const callsAfterDay=modelCalls;await ai.maybeGenerate();
check('automatic generation can refill after 24 hours but does not repeat within the new interval',callsAfterDay===callsAfterGeneration+1&&modelCalls===callsAfterDay);
const oldTracks=ai.store.ai.tracks.length;
ai.requestAI=async()=>{throw new Error('AI_AUTH');};await ai.generate();
check('invalid key keeps the verified AI cache available',aiSnapshot.kind==='ai'&&aiSnapshot.error==='AI_AUTH'&&ai.store.ai.tracks.length===oldTracks);
config={...config,enabled:false};ai.configChanged();
check('turning AI off immediately restores basic recommendations',aiSnapshot.kind==='basic');

let resolveOld;config={...config,enabled:true,revision:'second'};
ai.requestAI=()=>new Promise(resolve=>resolveOld=resolve);
const oldGeneration=ai.generate();await until(()=>!!resolveOld);
config={...config,enabled:false,revision:'third'};ai.configChanged();resolveOld({songs:[song(55)]});await oldGeneration;
check('late model responses cannot restore cleared or changed configuration',ai.store.ai.tracks.length===0&&aiSnapshot.kind==='basic');
await rejectsCode(()=>ai.job(()=>new Promise(()=>{}),5),'AI_TIMEOUT');
check('timeouts also stop adapters that ignore AbortSignal',true);

for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','172.20.0.1','192.168.0.1','0.0.0.0','198.18.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2001:0000::1','2002:7f00:1::']) assert.equal(isPublicAddress(address),false,address);
check('relay excludes private, loopback, mapped, link-local and special IP ranges',isPublicAddress('8.8.8.8')&&isPublicAddress('2606:4700:4700::1111'));
await rejectsCode(()=>resolvePublicEndpoint(aiEndpoint('https://example.com'),async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),'AI_ENDPOINT');
await rejectsCode(()=>resolvePublicEndpoint(aiEndpoint('https://127.1')),'AI_ENDPOINT');
check('mixed public/private DNS and alternate IP spellings are rejected',true);

let sent,fail=false;
const handler=createAIHandler({send:async value=>{sent=value;if(fail) throw new Error('provider echoed a private key');return value.request.max_tokens===8?{choices:[{message:{content:'OK'}}]}:modelResult([song(1)]);}});
const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
const call=(method,body,{authorization='Bearer test-secret',type='application/json'}={})=>new Promise((resolve,reject)=>{
  const payload=typeof body==='string'?body:JSON.stringify(body||{});
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/recommendations/ai',method,headers:{Authorization:authorization,'Content-Type':type,'Content-Length':Buffer.byteLength(payload)}},res=>{let content='';res.on('data',d=>content+=d);res.on('end',()=>resolve({status:res.statusCode,body:content,headers:res.headers}));});
  req.on('error',reject);req.end(payload);
});
try {
  const body={baseUrl:'https://example.com/v1',model:'test-model',mode:'recommend',profile:{liked:[song(1)],apiKey:'must-not-forward'}};
  const ok=await call('POST',body);
  check('relay forwards a bounded request and returns only parsed song metadata',ok.status===200&&JSON.parse(ok.body).songs.length===1&&!JSON.stringify(sent.request).includes('must-not-forward'));
  check('relay responses are not cached',ok.headers['cache-control']==='no-store');
  const test=await call('POST',{...body,mode:'test'});
  check('connection test uses a tiny request without sending listening preferences',test.status===200&&sent.request.max_tokens===8&&!JSON.stringify(sent.request).includes('Song 1'));
  check('relay rejects generic methods and invalid bodies',(await call('GET',body)).status===405&&(await call('POST','{')).status===400&&(await call('POST',body,{authorization:''})).status===400);
  check('oversized relay input is rejected',(await call('POST','x'.repeat(25000))).status===400);
  fail=true;const failure=await call('POST',body);
  check('relay never exposes provider error bodies or credentials',failure.status===502&&failure.body==='{"error":"AI_UNAVAILABLE"}');
} finally {server.close();await once(server,'close');}

engine.cancel();reloaded.cancel();ai.cancel();
process.exit(finish());
