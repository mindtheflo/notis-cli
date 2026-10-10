/** Offline, frozen Space fixtures. No credentials or provider transport exist here. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { appFilesDigest } from './app-platform.js';
import { usageError } from './errors.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
// Credentialless worker + non-forwarding proxy own the offline boundary.
// Source shares the Shadow host realm and may call only this fixture origin.
const HOST_POLICY="default-src 'none'; script-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'";

function object(value) { return value && typeof value==='object' && !Array.isArray(value); }
/** The declared params a list's filter reads (server shown_list_params); `{record}` reads the first record param. */
function shownListParams(where, params) {
  const declared=object(params) ? params : {};
  const single=Object.entries(declared).find(([,item])=>object(item) && item.type==='record')?.[0] ?? null;
  const names=new Set();
  const walk=node=>{
    if(!object(node)) return;
    for(const group of ['and','or']) if(Array.isArray(node[group])) { node[group].forEach(walk); return; }
    for(const value of Array.isArray(node.value)?node.value:[node.value]) {
      const match=typeof value==='string' ? /^\{([a-z][A-Za-z0-9_]{0,63})(?:\.([^{}.\s][^{}]{0,199}))?\}$/.exec(value) : null;
      const name=match?.[1]==='record' ? single : match?.[1];
      if(name && Object.hasOwn(declared,name)) names.add(name);
    }
  };
  walk(where);
  return [...names].sort();
}
/** Public runtime declarations (server declared_view_runtime): params, list names and chrome, never filters. */
function viewDeclarations(manifest) {
  const shows=Object.fromEntries(Object.entries(manifest.shows || {}).map(([name,value])=>[name,Object.hasOwn(value,'where')
    ? {database:value.database,...(value.open?{open:value.open}:{}),params:shownListParams(value.where,manifest.params)} : {about:value.about,...(value.services?.length?{services:value.services}:{})}]));
  return {...(manifest.params && Object.keys(manifest.params).length?{params:structuredClone(manifest.params)}:{}),
    ...(Object.keys(shows).length?{shows}:{}),...(['portal','hidden'].includes(manifest.chrome)?{chrome:manifest.chrome}:{})};
}
const VIEWER_READS={list_databases:'databases',get_database:'databases',query_database:'databases',list_skills:'skills',get_skill:'skills'};

export function createSpaceFixtureEngine(release) {
  const bodyTemplates=structuredClone(release.manifest.actions || {});
  const bodyResources=structuredClone(release.manifest.resources || {});
  let fixtures={actions:{}};
  if(release.fixturePath) {
    const encoded=release.sourceFiles[release.fixturePath];
    if(typeof encoded!=='string') throw usageError('The selected verification fixtures are missing from the frozen source.');
    try { fixtures=JSON.parse(Buffer.from(encoded,'base64').toString('utf8')); }
    catch { throw usageError('Verification fixtures must be finite JSON objects.'); }
  }
  if(!object(fixtures) || Object.keys(fixtures).some(key=>!['actions','context','documentBodies','viewerReads','shown','recordViews'].includes(key)) || !object(fixtures.actions)
    || (fixtures.context!==undefined && !object(fixtures.context))) throw usageError('Verification fixtures declare actions and optional synthetic context.');
  // Viewer reads have no grant: fixtures stand in for what a signed-in viewer could open.
  const declaredReads=release.manifest.viewer_reads || [];
  // V4: a declared list is served from fixtures per exact params, like a signed-in Editor's read.
  const declaredLists=Object.fromEntries(Object.entries(release.manifest.shows || {}).filter(([,value])=>object(value) && Object.hasOwn(value,'where')));
  const shownCases=fixtures.shown ?? {};
  if(!object(shownCases)) throw usageError('Declare shown fixtures by list name.');
  for(const [name,cases] of Object.entries(shownCases)) {
    if(!Object.hasOwn(declaredLists,name) || !Array.isArray(cases) || !cases.length || cases.length>100) {
      throw usageError(`Declare shown fixtures only for lists this view declares with a filter (${name}).`);
    }
    const previous=[];
    for(const entry of cases) {
      if(!object(entry) || Object.keys(entry).some(key=>!['params','result'].includes(key)) || !object(entry.params) || !object(entry.result)) {
        throw usageError(`Declare each ${name} fixture as params and a result.`);
      }
      if(previous.some(params=>isDeepStrictEqual(params,entry.params))) throw usageError(`Ambiguous shown fixture for ${name}.`);
      previous.push(entry.params);
    }
  }
  const readCases=fixtures.viewerReads ?? {};
  if(!object(readCases)) throw usageError('Declare viewerReads fixtures by read operation.');
  for(const [operation,cases] of Object.entries(readCases)) {
    if(!Object.hasOwn(VIEWER_READS,operation) || !declaredReads.includes(VIEWER_READS[operation]) || !Array.isArray(cases) || !cases.length || cases.length>100) {
      throw usageError(`Declare explicit viewer read fixtures only for reads this Space declares (${operation}).`);
    }
    const previous=[];
    for(const entry of cases) {
      if(!object(entry) || Object.keys(entry).some(key=>!['input','result'].includes(key)) || !Object.hasOwn(entry,'result') || !object(entry.input)) {
        throw usageError(`Declare each ${operation} fixture as an input object and a result.`);
      }
      if(previous.some(input=>isDeepStrictEqual(input,entry.input))) throw usageError(`Ambiguous viewer read fixture for ${operation}.`);
      previous.push(entry.input);
    }
  }
  const ajv=new Ajv2020({strict:false,strictNumbers:true,allErrors:true,coerceTypes:false,useDefaults:false,removeAdditional:false});
  addFormats(ajv);
  const validators=new Map();
  for(const [name,template] of Object.entries(release.manifest.actions || {})) {
    let validate;
    try { validate=ajv.compile(template.inputs); }
    catch { throw usageError(`Cannot validate the declared inputs for ${name}.`); }
    validators.set(name,validate);
  }
  for(const [name,cases] of Object.entries(fixtures.actions)) {
    const validate=validators.get(name);
    if(!validate || !Array.isArray(cases) || !cases.length || cases.length>100) throw usageError(`Declare explicit fixture cases for the known action ${name}.`);
    const previous=[];
    for(const entry of cases) {
      if(!object(entry) || Object.keys(entry).some(key=>!['inputs','result'].includes(key)) || !Object.hasOwn(entry,'result')
        || !object(entry.inputs) || !validate(entry.inputs)) throw usageError(`Fixture inputs do not match the declared action ${name}.`);
      if(previous.some(inputs=>isDeepStrictEqual(inputs,entry.inputs))) throw usageError(`Ambiguous fixture inputs for ${name}.`);
      previous.push(entry.inputs);
    }
  }
  const bodies=fixtures.documentBodies || [];
  if(!Array.isArray(bodies) || bodies.length>100) throw usageError('Declare bounded synthetic documentBodies fixtures.');
  function bodyRequest(request) {
    if(!object(request) || Object.keys(request).sort().join(',')!=='binding,operation,readAction,recordKey'
      || request.operation!=='read' || typeof request.recordKey!=='string' || !/^[a-f0-9-]{36}$/i.test(request.recordKey)) {
      throw usageError('Verification supports exact synthetic document body reads only.');
    }
    const template=bodyTemplates[request.readAction];
    if(bodyResources[request.binding]?.kind!=='database' || template?.tool!=='LOCAL_NOTIS_DATABASE_QUERY'
      || !isDeepStrictEqual(template.arguments,{database_id:{$asset:request.binding},request:{$input:'request'}})) {
      throw usageError('Choose a declared canonical query action for this document binding.');
    }
    const inputs={request:{filter:{field:{column:'record_key'},op:'equals',value:request.recordKey},page_size:1,include_content:true}};
    if(!validators.get(request.readAction)?.(inputs)) throw usageError('The body read inputs do not match this action declaration.');
  }
  const previousBodies=[];
  for(const entry of bodies) {
    if(!object(entry) || Object.keys(entry).some(key=>!['request','result'].includes(key))) throw usageError('Declare a document body request and result.');
    bodyRequest(entry.request);
    const result=entry.result;
    if(!object(result) || Object.keys(result).some(key=>!['record_key','title','revision','schema_revision','content_markdown'].includes(key))
      || result.record_key!==entry.request.recordKey || typeof result.content_markdown!=='string'
      || !Number.isSafeInteger(result.revision) || result.revision<1 || !Number.isSafeInteger(result.schema_revision) || result.schema_revision<0
      || (result.title!==null && typeof result.title!=='string')) throw usageError('Declare a complete synthetic document body result.');
    if(previousBodies.some(request=>isDeepStrictEqual(request,entry.request))) throw usageError('Ambiguous document body fixture.');
    previousBodies.push(entry.request);
  }
  // First-party record components use explicit readonly fixtures. They never
  // need a collaboration token, upload path, property writer or database key.
  const recordViews=fixtures.recordViews ?? [];
  if(!Array.isArray(recordViews) || recordViews.length>100) throw usageError('Declare bounded synthetic recordViews fixtures.');
  const recordDeclarations=Object.values(release.manifest.params || {}).filter(value=>value?.type==='record');
  const previousViews=new Set();
  for(const entry of recordViews) {
    if(!object(entry) || Object.keys(entry).sort().join(',')!=='operation,record_key,result'
      || !['record','html','report'].includes(entry.operation) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(entry.record_key)
      || !object(entry.result) || !recordDeclarations.length
      || !recordDeclarations.every(value=>bodyResources[value.database]?.kind==='database')) throw usageError('Declare readonly recordViews only for a declared native record param.');
    const identity=entry.operation+':'+entry.record_key;
    if(previousViews.has(identity)) throw usageError('Ambiguous record view fixture.');
    previousViews.add(identity);
    const value=entry.result;
    if(entry.operation==='record' && (value.record_key!==entry.record_key || !object(value.document) || !object(value.schema)
      || value.writable!==false || Object.hasOwn(value,'target') || value.document.record_key!==entry.record_key)) throw usageError('Record fixtures must be readonly snapshots without authoring targets.');
    if(entry.operation==='html' && (typeof value.html!=='string' || value.record_key!==entry.record_key)) throw usageError('HTML fixtures contain a record key and HTML.');
    if(entry.operation==='report' && (typeof value.source!=='string' || typeof value.export_name!=='string')) throw usageError('Report fixtures contain an explicit readonly source and export.');
  }
  return { context:fixtures.context || {}, digest:createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),
    executeRecordView(operation,key) {
      const match=recordViews.find(value=>value.operation===operation && value.record_key===key);
      if(!match) throw usageError('Add an explicit synthetic record view fixture.');
      return structuredClone(match.result);
    },
    executeBody(request) {
      bodyRequest(request);
      const matched=bodies.find(entry=>isDeepStrictEqual(entry.request,request));
      if(!matched) throw usageError('Add an explicit synthetic document body fixture.');
      return structuredClone(matched.result);
    },
    executeShown(name,params) {
      if(!Object.hasOwn(declaredLists,name)) throw usageError('This view does not declare that list.');
      if(!object(params)) throw usageError('List params must be an object.');
      const matched=shownCases[name]?.find(entry=>isDeepStrictEqual(entry.params,params));
      if(!matched) throw usageError(`Add an explicit synthetic shown fixture for ${name} and these params.`);
      return structuredClone(matched.result);
    },
    executeViewerRead(operation,input) {
      if(!Object.hasOwn(VIEWER_READS,operation) || !declaredReads.includes(VIEWER_READS[operation])) throw usageError('This Space does not declare that viewer read.');
      if(!object(input)) throw usageError('Viewer read inputs must be an object.');
      const matched=readCases[operation]?.find(entry=>isDeepStrictEqual(entry.input,input));
      if(!matched) throw usageError(`Add an explicit synthetic viewer read fixture for ${operation} and this input.`);
      return structuredClone(matched.result);
    },
    execute(name,inputs) {
      const validate=validators.get(name);
      if(!validate || !object(inputs) || !validate(inputs)) throw usageError('The action inputs do not match this Space declaration.');
      const matched=fixtures.actions[name]?.find(entry=>isDeepStrictEqual(entry.inputs,inputs));
      if(!matched) throw usageError(`Add an explicit synthetic fixture for action ${name} and these inputs.`);
      return structuredClone(matched.result);
    } };
}

export function spaceHarnessSnapshot(release,capabilities,engine,{authorizationMode='authorize_missing',unavailableActions=[]}={}) {
  if(release.manifest.kind!=='presentation') throw usageError('Containers do not have an executable preview.');
  const manifest=release.manifest;
  const names=Object.keys(manifest.actions || {}).sort();
  if(!object(capabilities?.actions) || !object(capabilities?.bindings)
    || !['authorize_missing','reuse_only'].includes(authorizationMode) || !Array.isArray(unavailableActions)
    || unavailableActions.some(name=>typeof name!=='string') || new Set(unavailableActions).size!==unavailableActions.length) {
    throw usageError('Verify current action authorizations before rendering this Space.');
  }
  const available=Object.keys(capabilities.actions).sort();
  const missing=names.filter(name=>!Object.hasOwn(capabilities.actions,name));
  if(available.some(name=>!names.includes(name))
    || (authorizationMode==='authorize_missing' && (missing.length || unavailableActions.length))
    || (authorizationMode==='reuse_only' && !isDeepStrictEqual([...unavailableActions].sort(),missing))) {
    throw usageError(authorizationMode==='authorize_missing'
      ? 'Verify current action authorizations before rendering this Space.'
      : 'Verify the exact unavailable action declarations before rendering this Space.');
  }
  const actions=Object.fromEntries(available.map(name=>{
    const descriptor=capabilities.actions[name];
    if(typeof descriptor.readOnly!=='boolean' || !isDeepStrictEqual(descriptor.inputSchema,manifest.actions[name].inputs)) {
      throw usageError('The verified action descriptor changed. Verify this build again.');
    }
    return [name,{id:name,inputSchema:descriptor.inputSchema,readOnly:descriptor.readOnly}];
  }));
  const bindings=Object.fromEntries(Object.entries(capabilities.bindings).map(([name,value])=>
    [name,{kind:value.kind,...(value.operations?{operations:value.operations}:{})}]));
  if(authorizationMode==='reuse_only' && Object.values(bindings).some(binding=>
    Object.values(binding.operations || {}).some(name=>!Object.hasOwn(actions,name)))) {
    throw usageError('An unavailable action cannot become a fixture binding operation.');
  }
  const navigation=Object.keys(manifest.navigation || {}).sort();
  if(!isDeepStrictEqual([...(capabilities.navigation || [])].sort(),navigation)) throw usageError('The verified navigation declaration changed. Verify this build again.');
  const viewerReads=[...(manifest.viewer_reads || [])];
  if(!isDeepStrictEqual([...(capabilities.viewerReads || [])],viewerReads)) throw usageError('The verified viewer reads changed. Verify this build again.');
  const identity=`verification:${manifest.local_key}`;
  const artifact=appFilesDigest(release.files);
  const js=manifest.bundle?.js,css=manifest.bundle?.css;
  if(!js || !release.files[js] || (css && typeof release.files[css]!=='string')) throw usageError('The selected presentation bundle or stylesheet is missing.');
  return { source:Buffer.from(release.files[js],'base64').toString('utf8'),
    css:css?Buffer.from(release.files[css],'base64').toString('utf8'):'',
    cacheKey:`${artifact}:${engine.digest}`,exportCandidates:['SpaceView'],
    descriptor:{resource:{kind:'space',id:identity,revision:1},
      space:{id:identity,revision:1,cacheScope:`stub:${artifact}:${engine.digest}`,actions,bindings,...(navigation.length?{navigation}:{}),
        ...(viewerReads.length?{viewerReads}:{}),...viewDeclarations(manifest)},
      app:{id:identity,name:manifest.name},route:{slug:'view',path:'/',name:manifest.name},context:engine.context} };
}

/** Existing CLI theme only; the legacy executable/JWT HTML is never served. */
function themeCss() {
  const template=readFileSync(join(ROOT,'template/.harness/index.html.tmpl'),'utf8');
  const css=template.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  if(!css) throw usageError('The verification theme is missing. Rebuild the CLI package.');
  return css;
}

export async function startSpaceTestServer({release,capabilities,port=0,authorizationMode='authorize_missing',unavailableActions=[]}) {
  const engine=createSpaceFixtureEngine(release),snapshot=spaceHarnessSnapshot(release,capabilities,engine,{authorizationMode,unavailableActions});
  const assets={host:readFileSync(join(ROOT,'dist/space-harness/host.js')),css:themeCss()};
  const server=createServer(async(req,res)=>{
    const response=(status,body,type='application/json')=>{
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Referrer-Policy':'no-referrer','Content-Security-Policy':HOST_POLICY,
        'Cross-Origin-Resource-Policy':'same-origin'});
      res.end(req.method==='HEAD'?undefined:body);
    };
    try {
      const origin=`http://127.0.0.1:${server.address().port}`;
      const target=new URL(req.url || '/',origin);
      // Also serve as the verification browser's non-forwarding proxy. An
      // executable cannot escape to another localhost port by navigating.
      if(target.origin!==origin || req.headers.host!==new URL(origin).host) return response(403,'{}');
      const path=target.pathname;
      if(req.headers.origin && req.headers.origin!==origin) return response(403,'{}');
      if(req.method==='GET' || req.method==='HEAD') {
        if(path==='/') return response(200,'<!doctype html><meta charset="utf-8"><title>Space verification</title><link rel="stylesheet" href="/theme.css"><script defer src="/host.js"></script>','text/html; charset=utf-8');
        if(path==='/host.js') return response(200,assets.host,'text/javascript');
        if(path==='/theme.css') return response(200,assets.css,'text/css');
        if(path==='/snapshot') return response(200,JSON.stringify(snapshot));
      }
      if(req.method==='POST' && path==='/fixture' && req.headers['content-type']?.split(';')[0]==='application/json') {
        const chunks=[];let length=0;
        for await(const chunk of req) {
          length+=chunk.length;
          if(length>1_000_000) {response(413,'{}');req.destroy();return;}
          chunks.push(chunk);
        }
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(object(input) && Object.keys(input).length===1 && Object.hasOwn(input,'shown')) {
          const list=input.shown;
          if(!object(list) || Object.keys(list).sort().join(',')!=='name,params') return response(400,'{}');
          try {return response(200,JSON.stringify({result:engine.executeShown(list.name,list.params)}));}
          catch(error) {return response(400,JSON.stringify({message:error.message}));}
        }
        if(object(input) && Object.keys(input).length===1 && Object.hasOwn(input,'viewer_read')) {
          const read=input.viewer_read;
          if(!object(read) || Object.keys(read).sort().join(',')!=='input,operation') return response(400,'{}');
          try {return response(200,JSON.stringify({result:engine.executeViewerRead(read.operation,read.input)}));}
          catch(error) {return response(400,JSON.stringify({message:error.message}));}
        }
        if(object(input) && Object.keys(input).length===1 && Object.hasOwn(input,'document_body')) {
          if(snapshot.descriptor.space.actions[input.document_body?.readAction]?.readOnly!==true) return response(403,'{}');
          try {return response(200,JSON.stringify({result:engine.executeBody(input.document_body)}));}
          catch(error) {return response(400,JSON.stringify({message:error.message}));}
        }
        if(!object(input) || Object.keys(input).some(key=>!['action_id','inputs'].includes(key))) return response(400,'{}');
        if(snapshot.descriptor.space.actions[input.action_id]?.readOnly!==true) return response(403,'{}');
        try { return response(200,JSON.stringify({result:engine.execute(input.action_id,input.inputs)})); }
        catch(error) {return response(400,JSON.stringify({message:error.message}));}
      }
      response(404,'{}');
    } catch {response(400,JSON.stringify({message:'Invalid verification request.'}));}
  });
  // This is an asset/fixture server, never a CONNECT or WebSocket proxy.
  // These events hand the raw socket to us, outside HTTP's usual lifecycle.
  // A browser resetting a denied tunnel must close only that connection, not
  // become an unhandled Socket error that kills every fixture presentation.
  const deniedSockets=new Set();
  const denyTunnel=(_req,socket)=>{
    deniedSockets.add(socket);
    socket.on('error',()=>socket.destroy());
    socket.once('close',()=>deniedSockets.delete(socket));
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n',()=>socket.destroy());
  };
  server.on('connect',denyTunnel);
  server.on('upgrade',denyTunnel);
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);accept();});});
  let closing;
  const rendererDigest=createHash('sha256').update(assets.host).update(assets.css).digest('hex');
  return {url:`http://127.0.0.1:${server.address().port}`,fixtureDigest:engine.digest,rendererDigest,
    close(){return closing ||= new Promise(accept=>{
      server.close(accept);server.closeAllConnections?.();
      for(const socket of deniedSockets) socket.destroy();
    });}};
}
