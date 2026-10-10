import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { spacesCommandSpecs } from '../src/command-specs/spaces.js';
import { appFilesDigest } from '../src/runtime/app-platform.js';

function archive(files) {
  const entries=Object.entries(files).map(([name,value])=>{
    const content=Buffer.from(value),header=Buffer.alloc(512);
    header.write(name,0,100,'utf8');header.write('0000644\0',100,8,'ascii');
    header.write(content.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');
    header.fill(32,148,156);header.write('0',156,1,'ascii');header.write('ustar\0',257,6,'ascii');
    const checksum=header.reduce((sum,byte)=>sum+byte,0);
    header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
    return Buffer.concat([header,content,Buffer.alloc(Math.ceil(content.length/512)*512-content.length)]);
  });
  return gzipSync(Buffer.concat([...entries,Buffer.alloc(1024)]));
}

function fixture(t,files={'package.json':'{}','notis.config.ts':'export default {};','view.tsx':'export default () => null;','binary.bin':Buffer.from([0,255,128])},{links=[],skills={}}={}) {
  const root=mkdtempSync(join(tmpdir(),'notis-space-pull-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bytes=archive(files),calls=[];
  const payload={space_id:'fixture-space',revision:3,archive_format:'tar-gzip-v1',source_digest:'a'.repeat(64),
    archive_sha256:createHash('sha256').update(bytes).digest('hex'),source_archive:bytes.toString('base64'),
    manifest:{local_key:'overview'}};
  t.mock.method(globalThis,'fetch',async(url,request)=>{
    calls.push({url,request});
    if(url.includes('/portal_spaces/space-links'))return new Response(JSON.stringify({links}));
    if(url.includes('/portal_skills/native-authoring')){
      const read=skills[JSON.parse(request.body).target.binding_id];
      return read?new Response(JSON.stringify(read)):new Response(JSON.stringify({error:'skill_unavailable',message:'Read-only'}),{status:404});
    }
    return new Response(JSON.stringify(payload));
  });
  const spec=spacesCommandSpecs.find(s=>s.command_path.join(' ')==='spaces pull');
  const ctx={spec,args:{spaceId:'fixture-space',dir:join(root,'destination')},options:{},globalOptions:{},
    runtime:{credentialKind:'env',profileName:'fixture',jwt:'fixture-token',apiBase:'https://fixture.invalid',timeoutMs:1000},
    output:{emitSuccess:value=>value}};
  return {root,ctx,payload,calls};
}

test('Space pull uses scoped archive transport and roundtrips source without legacy App identity',async t=>{
  const {ctx,calls}=fixture(t);
  const result=await ctx.spec.handler(ctx);
  assert.equal(result.data.version,3);
  assert.equal(calls[0].url,'https://fixture.invalid/portal_spaces/source?space_id=fixture-space&format=archive');
  assert.equal(calls[0].request.headers['X-Notis-Spaces-Protocol'],'1');
  assert.deepEqual(readFileSync(join(ctx.args.dir,'binary.bin')),Buffer.from([0,255,128]));
  assert.equal(readFileSync(join(ctx.args.dir,'view.tsx'),'utf8'),'export default () => null;');
  const state=JSON.parse(readFileSync(join(ctx.args.dir,'.notis/space-source.json'),'utf8'));
  assert.deepEqual(state,{space_id:'fixture-space',api_base:'https://fixture.invalid',source_digest:'a'.repeat(64),local_key:'overview',revision:3});
  assert.equal(existsSync(join(ctx.args.dir,'.notis/state.json')),false);
  assert.ok(!JSON.stringify(state).includes('fixture-token'));
  assert.equal(calls[1].url,'https://fixture.invalid/portal_spaces/space-links?space_id=fixture-space');
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.args.dir,'resources.json'),'utf8')),[]);
  const lock=JSON.parse(readFileSync(join(ctx.args.dir,'.notis/space-lock.json'),'utf8'));
  assert.equal(lock.version,1);assert.equal(lock.space_id,'fixture-space');assert.deepEqual(lock.links,[]);assert.deepEqual(lock.skills,{});
  assert.ok(!JSON.stringify(lock).includes('fixture-token'));
});

test('pull writes the resource list, every editable Skill folder and a lock outside the portable source',async t=>{
  const files={'SKILL.md':Buffer.from('---\nname: guide\ndescription: "Pulled"\n---\n# Guide').toString('base64'),'scripts/run.py':Buffer.from('print(1)').toString('base64')};
  // A bytecode cache stored with the bundle is neither written nor hashed: the local folder scan skips it too.
  const bundle={...files,'scripts/__pycache__/run.cpython-312.pyc':Buffer.from([0x33,0x0d]).toString('base64')};
  const links=[{binding_id:'b-guide',alias:'guide',revision:1,kind:'skill',resource_id:'skill-guide',available:true},
    {binding_id:'b-rows',alias:'rows',revision:2,kind:'database',resource_id:'db-rows',available:true},
    {binding_id:'b-curated',alias:'curated',revision:1,kind:'skill',resource_id:'skill-curated',available:true},
    {binding_id:'b-gone',alias:'gone',revision:1,kind:'skill',resource_id:'skill-gone',available:false},
    {binding_id:'b-doc',alias:'note',revision:1,kind:'document',resource_id:'doc-1',available:true}];
  const skills={'b-guide':{skill_id:'skill-guide',target:{space_id:'fixture-space',binding_id:'b-guide',binding_revision:1,expected_skill_id:'skill-guide',space_revision:4},
    version:{revision:3,digest:'a'.repeat(64)},definition:{name:'Guide',description:'Pulled',skill_md:'# Guide',files:bundle}}};
  const {ctx,calls}=fixture(t,undefined,{links,skills});
  const result=await ctx.spec.handler(ctx);
  assert.equal(readFileSync(join(ctx.args.dir,'skills/guide/SKILL.md'),'utf8'),'---\nname: guide\ndescription: "Pulled"\n---\n# Guide');
  assert.equal(readFileSync(join(ctx.args.dir,'skills/guide/scripts/run.py'),'utf8'),'print(1)');
  assert.equal(existsSync(join(ctx.args.dir,'skills/guide/scripts/__pycache__')),false);
  assert.equal(existsSync(join(ctx.args.dir,'skills/curated')),false);assert.equal(existsSync(join(ctx.args.dir,'skills/gone')),false);
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.args.dir,'resources.json'),'utf8')),[
    {kind:'skill',id:'skill-curated',alias:'curated'},{kind:'skill',id:'skill-gone',alias:'gone'},
    {kind:'skill',id:'skill-guide',alias:'guide'},{kind:'database',id:'db-rows',alias:'rows'}],'Document links are not resource links');
  const lock=JSON.parse(readFileSync(join(ctx.args.dir,'.notis/space-lock.json'),'utf8'));
  assert.deepEqual(lock.links.map(link=>[link.alias,link.binding_id,link.binding_revision,link.available]),
    [['curated','b-curated',1,true],['gone','b-gone',1,false],['guide','b-guide',1,true],['rows','b-rows',2,true]]);
  assert.deepEqual(lock.skills,{guide:{skill_id:'skill-guide',binding_id:'b-guide',binding_revision:1,version:{revision:3,digest:'a'.repeat(64)},
    folder_hash:appFilesDigest(files)}});
  assert.equal(lock.source_revision,3);
  assert.deepEqual(result.data.skipped,[{alias:'curated',reason:'read-only'},{alias:'gone',reason:'unavailable'}]);
  assert.deepEqual(result.data.skills,['guide']);assert.equal(result.data.links.length,4);
  const reads=calls.filter(call=>call.url.endsWith('/portal_skills/native-authoring'));
  assert.deepEqual(reads.map(call=>JSON.parse(call.request.body)),[
    {operation:'read',target:{space_id:'fixture-space',binding_id:'b-guide'},include_files:true},
    {operation:'read',target:{space_id:'fixture-space',binding_id:'b-curated'},include_files:true}],'Unavailable links are never read');
  assert.ok(reads.every(call=>call.request.headers['X-Notis-Spaces-Protocol']==='1'));
  assert.match(result.humanSummary,/4 linked resources in resources.json, 1 Skill folders/);
  assert.equal(result.warnings.length,1);
});

test('pull refuses Skill files that do not match their link before writing them',async t=>{
  const links=[{binding_id:'b-guide',alias:'guide',revision:1,kind:'skill',resource_id:'skill-guide',available:true}];
  const skills={'b-guide':{skill_id:'another-skill',target:{binding_id:'b-guide',binding_revision:1},version:{revision:1,digest:'a'.repeat(64)},
    definition:{files:{'SKILL.md':Buffer.from('# Guide').toString('base64')}}}};
  const {ctx}=fixture(t,undefined,{links,skills});
  await assert.rejects(ctx.spec.handler(ctx),/verified files of Skill guide/);
  assert.equal(existsSync(join(ctx.args.dir,'skills')),false);
});

test('pull refuses populated destinations before requesting or overwriting source',async t=>{
  const {ctx,calls}=fixture(t);mkdirSync(ctx.args.dir);writeFileSync(join(ctx.args.dir,'keep.txt'),'keep');
  await assert.rejects(ctx.spec.handler(ctx),/not empty/);
  assert.equal(calls.length,0);assert.equal(readFileSync(join(ctx.args.dir,'keep.txt'),'utf8'),'keep');
});

test('fingerprint, wrong Space and wrong revision fail before source files are installed',async t=>{
  const {ctx,payload}=fixture(t);
  payload.archive_sha256='b'.repeat(64);
  await assert.rejects(ctx.spec.handler(ctx),/fingerprint/);assert.equal(existsSync(ctx.args.dir),false);
  payload.archive_sha256=createHash('sha256').update(Buffer.from(payload.source_archive,'base64')).digest('hex');
  payload.space_id='another-space';
  await assert.rejects(ctx.spec.handler(ctx),/snapshot/);assert.equal(existsSync(ctx.args.dir),false);
  payload.space_id='fixture-space';ctx.options.revision='2';
  await assert.rejects(ctx.spec.handler(ctx),/server returned version 3/);assert.equal(existsSync(ctx.args.dir),false);
});

for (const path of ['../outside.txt','.env','.NOTIS/private.json']) {
  test(`archive path ${path} cannot write private/outside state`,async t=>{
    const {ctx,root}=fixture(t,{[path]:'must-not-write'});
    await assert.rejects(ctx.spec.handler(ctx),/unsafe|local-only/);
    assert.equal(existsSync(join(root,'outside.txt')),false);
    if(existsSync(ctx.args.dir))assert.deepEqual(readdirSync(ctx.args.dir),[]);
  });
}

test('a directory alias cannot redirect source into another project',async t=>{
  const {ctx,root,calls}=fixture(t);const target=join(root,'private-project');mkdirSync(target);
  symlinkSync(target,ctx.args.dir,'dir');
  await assert.rejects(ctx.spec.handler(ctx),/symlink|unsafe|real directory/i);
  assert.equal(calls.length,0);assert.deepEqual(readdirSync(target),[]);
});
