import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProcessDiagnosticsSql, diagnosticCommandSpecs } from '../src/command-specs/diagnostics.js';

test('process diagnostics escape references and cannot execute Temporal mutations', () => {
  assert.equal(buildProcessDiagnosticsSql("root'; DELETE FROM interactions; --"),
    "BEGIN READ ONLY; SET LOCAL request.jwt.claim.role='service_role'; SELECT public.notis_process_diagnostics_v1('root''; DELETE FROM interactions; --') AS diagnostic; COMMIT;");
  assert.throws(() => buildProcessDiagnosticsSql(''));
  assert.throws(() => buildProcessDiagnosticsSql('x'.repeat(257)));
  const command = diagnosticCommandSpecs.find(s => s.command_path.join(' ') === 'debug process');
  assert.equal(command.mutates, false);
  assert.equal(command.backend_call.type, 'tool-discovery');
});

test('process command discovers App SQL, uses a read-only transaction and emits the canonical bundle', async () => {
  const {createServer}=await import('node:http');
  const requests=[];
  const diagnostic={definition_version:1,interaction_id:'root-1',environment:'beta',user_outcome:'completed',handling:'recovered'};
  const server=createServer((req,res)=>{
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      const payload=JSON.parse(body);requests.push(payload);
      const response=payload.tool_name==='COMPOSIO_SEARCH_TOOLS'
        ? {results:[{primary_tool_slugs:['LOCAL_MCP_SUPABASE_NOTIS_WEBSITE_EXECUTE_SQL','LOCAL_MCP_SUPABASE_NOTIS_APP_EXECUTE_SQL']}]}:
        {results:[{response:{data:[{diagnostic}]}}]};
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const command=diagnosticCommandSpecs.find(s=>s.command_path.join(' ')==='debug process');
    let result;
    await command.handler({spec:command,args:{interactionId:'root-1'},options:{},
      runtime:{apiBase:`http://127.0.0.1:${server.address().port}`,credentialKind:'env',
        jwt:`${encode({alg:'none'})}.${encode({sub:'fixture',exp:Math.floor(Date.now()/1000)+3600})}.sig`,
        timeoutMs:5000,cliVersion:'test',outputMode:'json',profileName:'default'},
      output:{emitProgress(){},emitSuccess(value){result=value;}}});
    assert.deepEqual(result.data,diagnostic);
    assert.equal(result.meta.mutating,false);
    const execution=requests.find(r=>r.tool_name==='COMPOSIO_MULTI_EXECUTE_TOOL');
    assert.ok(execution.idempotency_key);
    assert.equal(execution.arguments.tools[0].tool_slug,'LOCAL_MCP_SUPABASE_NOTIS_APP_EXECUTE_SQL');
    assert.match(execution.arguments.tools[0].arguments.query,/^BEGIN READ ONLY;/);
    assert.equal(requests.length,2);
  } finally {await new Promise(resolve=>server.close(resolve));}
});


test('Langfuse v4 diagnostic IDs preserve legacy candidates and SQL matches UUID hex', async () => {
  const { langfuseTraceIdCandidates, buildTraceCostSql } = await import('../src/command-specs/diagnostics.js');
  const uuid = '9f9002d8-05c5-d78a-b105-b6f2422b25bc';
  const hex = uuid.replaceAll('-', '');
  assert.deepEqual(langfuseTraceIdCandidates(uuid), [hex, uuid]);
  assert.deepEqual(langfuseTraceIdCandidates(hex), [hex]);
  const sql = buildTraceCostSql(hex);
  assert.ok(sql.includes("replace(i.id::text, '-', '')"));
  assert.ok(sql.includes(`lower('${hex}')`));
  assert.ok(buildTraceCostSql("x' OR true --").includes("'x'' OR true --'"));
});
