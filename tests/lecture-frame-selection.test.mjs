import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('frame selector keeps temporal endpoints and prefers sharp stable frames after transitions', () => {
  const script = `import importlib.util, json
spec=importlib.util.spec_from_file_location('frames','scripts/extract-lecture-frames.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
candidates=[{'time':i*8,'changeScore':0.02,'sharpnessScore':0.4,'visualHash':format((i+1)*123456789,'016x')} for i in range(30)]
candidates[5].update(changeScore=0.9,sharpnessScore=0.1)
candidates[6].update(changeScore=0.01,sharpnessScore=1.0)
selected=module.choose_frames(candidates,8)
assert selected==sorted(set(selected)) and len(selected)==8
assert 0 in selected and 29 in selected and 6 in selected and 5 not in selected
assert module.choose_frames(candidates[:4],8)==[0,1,2,3]
print(json.dumps({'selected':selected}))`;
  const result = spawnSync(process.env.LOCAL_TRANSCRIPTION_PYTHON || (process.platform === 'win32' ? 'py' : 'python'), ['-c', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.ok(JSON.parse(result.stdout).selected.includes(6));
});

test('long lecture sampling limits temporal holes and saves readable board state before erasing',()=>{
  const script=`import importlib.util,json
spec=importlib.util.spec_from_file_location('frames','scripts/extract-lecture-frames.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
candidates=[{'time':i*8,'changeScore':0.02,'sharpnessScore':0.8,'visualHash':format((i+1)*987654321,'016x'),'contentScore':0.2} for i in range(494)]
candidates[301].update(changeScore=0.8,contentScore=0.01)
selected=module.choose_frames(candidates,96)
assert len(selected)==96 and selected[0]==0 and selected[-1]==493
assert max(candidates[b]['time']-candidates[a]['time'] for a,b in zip(selected,selected[1:]))<=80
assert any(i in selected for i in [298,299,300])
print(json.dumps({'count':len(selected)}))`;
  const result=spawnSync(process.env.LOCAL_TRANSCRIPTION_PYTHON||(process.platform==='win32'?'py':'python'),['-c',script],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr||result.error?.message);
});
