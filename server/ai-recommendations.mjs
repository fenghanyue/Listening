// A narrowly scoped JSON relay. Credentials are request-only and never logged or persisted.
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { aiEndpoint, buildAIRequest, parseAIResponse, validateAIConfig, aiHTTPError } from '../src/api/recommendations.mjs';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || a===100&&b>=64&&b<=127 || a===169&&b===254
      || a===172&&b>=16&&b<=31 || a===192&&(b===168 || b===0 || b===88&&c===99)
      || a===198&&(b===18 || b===19 || b===51&&c===100) || a===203&&b===0&&c===113);
  }
  if (isIP(address) === 6) {
    const value=address.toLowerCase();
    const [first,second]=value.split(':').map(part=>parseInt(part||'0',16));
    return /^[23][0-9a-f]{3}:/.test(value) && first!==0x2002 && first!==0x3fff
      && !(first===0x2001 && (second<0x200 || second===0xdb8));
  }
  return false;
}

export async function resolvePublicEndpoint(endpoint, resolve = lookup) {
  const host=endpoint.hostname.replace(/^\[|\]$/g,'');
  if (/^(?:localhost|.*\.localhost|.*\.local)$/i.test(host)) throw new Error('AI_ENDPOINT');
  const addresses=isIP(host) ? [{address:host,family:isIP(host)}] : await resolve(host,{all:true,verbatim:true});
  if(!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw new Error('AI_ENDPOINT');
  return addresses.find(item=>item.family===4) || addresses[0];
}

function outboundProxy(host, env) {
  const bypass=(env.NO_PROXY||env.no_proxy||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(bypass.some(item=>item==='*' || host===item.replace(/^\./,'') || host.endsWith('.'+item.replace(/^\./,'')))) return null;
  const value=env.HTTPS_PROXY||env.https_proxy||env.HTTP_PROXY||env.http_proxy;
  if(!value) return null;
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)) throw new Error('AI_UNAVAILABLE');
  return url;
}

async function pinnedSocket(endpoint, address, signal, env) {
  const proxy=outboundProxy(endpoint.hostname,env);
  let tunnel;
  if(proxy) {
    // CONNECT to the validated IP prevents a second DNS lookup from reaching a private address.
    tunnel=await new Promise((resolve,reject)=>{
      const destination=(address.family===6 ? `[${address.address}]` : address.address)+':443';
      const headers={Host:destination};
      if(proxy.username || proxy.password) headers['Proxy-Authorization']='Basic '+Buffer.from(decodeURIComponent(proxy.username)+':'+decodeURIComponent(proxy.password)).toString('base64');
      const request=(proxy.protocol==='https:' ? https : http).request(proxy,{method:'CONNECT',path:destination,headers,signal,agent:false});
      request.on('connect',(response,socket,head)=>{
        if(response.statusCode!==200) {socket.destroy();reject(new Error('AI_UNAVAILABLE'));return;}
        if(head.length) socket.unshift(head);
        resolve(socket);
      });
      request.on('error',reject);request.end();
    });
  }
  return new Promise((resolve,reject)=>{
    const socket=tls.connect({...(tunnel?{socket:tunnel}:{host:address.address,port:443}),servername:endpoint.hostname,rejectUnauthorized:true,signal});
    socket.once('secureConnect',()=>resolve(socket));socket.once('error',reject);
  });
}

export async function forwardAI({endpoint,apiKey,request,signal}, {resolve=lookup,env=process.env}={}) {
  let onAbort;
  const aborted=new Promise((_,reject)=>{onAbort=()=>reject(new Error('AI_TIMEOUT'));signal?.addEventListener('abort',onAbort,{once:true});});
  let address;
  try {address=await Promise.race([resolvePublicEndpoint(endpoint,resolve),aborted]);}
  finally {signal?.removeEventListener('abort',onAbort);}
  signal?.throwIfAborted();
  const socket=await pinnedSocket(endpoint,address,signal,env);
  const agent=new https.Agent({keepAlive:false});
  agent.createConnection=()=>socket;
  const payload=JSON.stringify(request);
  try {
    return await new Promise((resolve,reject)=>{
      const upstream=https.request(endpoint,{method:'POST',agent,signal,headers:{
        Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'identity','Content-Length':Buffer.byteLength(payload),
      }}, response=>{
        const chunks=[];let bytes=0;
        response.on('data',chunk=>{
          bytes+=chunk.length;
          if(bytes>131072) {response.destroy();reject(new Error('AI_BAD_RESPONSE'));} else chunks.push(chunk);
        });
        response.on('error',reject);
        response.on('end',()=>{
          // Never relay provider error bodies: they may echo the Authorization header.
          if(response.statusCode<200 || response.statusCode>=300) {reject(new Error(aiHTTPError(response.statusCode)));return;}
          try {resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));} catch {reject(new Error('AI_BAD_RESPONSE'));}
        });
      });
      upstream.on('error',reject);upstream.end(payload);
    });
  } finally {agent.destroy();socket.destroy();}
}

const safeErrors=new Set(['AI_CONFIG','AI_ENDPOINT','AI_AUTH','AI_RATE_LIMIT','AI_TIMEOUT','AI_BAD_RESPONSE','AI_UNAVAILABLE']);
export function createAIHandler({send=forwardAI,now=Date.now}={}) {
  const rates=new Map();
  return async function handle(req,res) {
    res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
    const reply=(status,body)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}};
    if(req.method!=='POST') {reply(405,{error:'AI_CONFIG'});return;}
    const clock=now(),ip=req.socket.remoteAddress||'';
    const rate=rates.get(ip);
    if(rate && clock-rate.at<600000 && rate.count>=20) {reply(429,{error:'AI_RATE_LIMIT'});return;}
    rates.set(ip,rate && clock-rate.at<600000 ? {at:rate.at,count:rate.count+1} : {at:clock,count:1});
    if(rates.size>512) for(const [key,value] of rates) if(clock-value.at>=600000) rates.delete(key);
    const controller=new AbortController();
    let reading=true;
    const timer=setTimeout(()=>{controller.abort();if(reading) req.destroy();},45000);
    const onClose=()=>{if(!res.writableEnded) controller.abort();};
    res.on('close',onClose);
    try {
      if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')) throw new Error('AI_CONFIG');
      if(Number(req.headers['content-length'])>24576) throw new Error('AI_CONFIG');
      const chunks=[];let size=0;
      for await(const chunk of req) {size+=chunk.length;if(size>24576) throw new Error('AI_CONFIG');chunks.push(chunk);}
      reading=false;
      let body;
      try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('AI_CONFIG');}
      const header=req.headers.authorization||'';
      if(!header.startsWith('Bearer ')) throw new Error('AI_CONFIG');
      const config=validateAIConfig({baseUrl:body?.baseUrl,model:body?.model,apiKey:header.slice(7)});
      if(body.mode!=='test' && body.mode!=='recommend') throw new Error('AI_CONFIG');
      const endpoint=aiEndpoint(config.baseUrl);
      const request=buildAIRequest({model:config.model,mode:body.mode,profile:body.profile});
      const result=await send({endpoint,apiKey:config.apiKey,request,signal:controller.signal});
      reply(200,parseAIResponse(result,body.mode));
    } catch(error) {
      const code=controller.signal.aborted ? 'AI_TIMEOUT' : safeErrors.has(error?.message) ? error.message : 'AI_UNAVAILABLE';
      const status=code==='AI_CONFIG'||code==='AI_ENDPOINT' ? 400 : code==='AI_AUTH' ? 401 : code==='AI_RATE_LIMIT' ? 429 : code==='AI_TIMEOUT' ? 504 : 502;
      reply(status,{error:code});
    } finally {clearTimeout(timer);res.removeListener('close',onClose);}
  };
}

export const handleAIRecommendations=createAIHandler();
