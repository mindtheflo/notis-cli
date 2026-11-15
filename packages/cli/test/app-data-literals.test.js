import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {maskSerializedJsonData} from '../src/runtime/app-data-literals.js';
import {collectArtifactBoundaryViolations,collectDesignViolationsForFile} from '../src/runtime/app-boundary-validator.js';
const cases=JSON.parse(readFileSync(new URL('./fixtures/app-serialized-data.json',import.meta.url),'utf8'));
for(const fixture of cases)test(`serialized data boundary: ${fixture.name}`,()=>{
 const boundary=collectArtifactBoundaryViolations({[fixture.path.endsWith('.css')?'bundle/app.css':'bundle/app.js']:fixture.source});
 assert.equal(boundary.length>0,fixture.boundary,JSON.stringify(boundary));
 const design=collectDesignViolationsForFile(fixture.path,fixture.source);
 assert.deepEqual([...new Set(design.map(row=>row.ruleId))].sort(),[...fixture.design_ids].sort());
 assert.equal(design.some(row=>row.allowed),fixture.any_allowed);
 const masked=maskSerializedJsonData(fixture.source,fixture.path.endsWith('.ts')?'.ts':'.tsx');
 assert.equal(masked.length,fixture.source.length);
 assert.deepEqual([...masked.matchAll(/\n/g)].map(match=>match.index),[...fixture.source.matchAll(/\n/g)].map(match=>match.index));
});

test('masked Unicode data does not move a real design violation line',()=>{
 const data=JSON.stringify(JSON.stringify({history:'é😀 document.body #ff0000'}));
 const source=`const title='😀';\nconst data=${data};\nconst Page=()=> <div className="bg-red-400"/>;\n`;
 assert.deepEqual(collectDesignViolationsForFile('app/page.tsx',source).map(row=>[row.ruleId,row.line]),[['no-palette-hue',3]]);
});

test('nested data is masked without climbing back up the tree',()=>{
 // Babel's own recursion stops between 100 and 200 levels (then nothing is masked and every check runs).
 const depth=100;
 const data=JSON.stringify(JSON.stringify({after:'document.body #ff0000'}));
 const source=`const t = ${"{ label: 'x', children: [".repeat(depth)}${data}${']}'.repeat(depth)};\nconst Page=()=> <div className="bg-red-400"/>;\n`;
 const started=performance.now();
 const masked=maskSerializedJsonData(source,'.tsx');
 const design=collectDesignViolationsForFile('app/page.tsx',source);
 assert.ok(performance.now()-started<10000);
 assert.ok(!masked.includes('document.body'));
 assert.equal(masked.length,source.length);
 assert.deepEqual(design.map(row=>[row.ruleId,row.line]),[['no-palette-hue',2]]);
});
