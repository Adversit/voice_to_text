'use strict';
// Explicit offline acceptance command. No fixture/model/package downloads.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const childProcess=require('node:child_process');
const {spawn}=childProcess;
const {createPaths,assertContained,inferenceEnv}=require('../core/paths.cjs');
const {createStore}=require('../core/store.cjs');
const {createMonitor}=require('../core/monitor.cjs');
const {defaults}=require('../core/contracts.cjs');
const {validateWav}=require('../core/audio.cjs');
const manifest=require('./model-manifest.cjs');
const ROOT=path.resolve(__dirname,'..');
const FIXTURE={name:'jfk.flac',revision:'86098128c0b4f24f0e2aa2994de830614b474227',bytes:1152693,gitBlob:'e44b7c13897eae7f78beb220c61fe77429a3961d',source:'https://github.com/openai/whisper/blob/86098128c0b4f24f0e2aa2994de830614b474227/tests/jfk.flac'};
const clone=value=>JSON.parse(JSON.stringify(value));
const memoryGB=()=>Math.round(os.freemem()/1024**3*100)/100;
function fault(code){return Object.assign(new Error(code),{code});}
async function hashes(file){
  const bytes=fs.statSync(file).size,sha256=createHash('sha256'),blob=createHash('sha1').update(`blob ${bytes}\0`);
  for await(const chunk of fs.createReadStream(file)){sha256.update(chunk);blob.update(chunk);}
  return {bytes,sha256:sha256.digest('hex'),gitBlob:blob.digest('hex')};
}
function pythonJSON(python,source,paths,args=[]){
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-B','-c',source,...args],{cwd:ROOT,env:inferenceEnv(paths),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let text='',overflow=false;
    child.stderr.resume();
    const timer=setTimeout(()=>{overflow=true;child.kill();},60000);
    child.stdout.on('data',chunk=>{text+=chunk.toString('utf8');if(text.length>1024*1024){overflow=true;child.kill();}});
    child.on('error',()=>{clearTimeout(timer);reject(fault('PYTHON_START_FAILED'));});
    child.on('close',code=>{clearTimeout(timer);if(overflow)return reject(fault('CONVERSION_TIMEOUT_OR_SIZE'));if(code!==0)return reject(fault('CONVERSION_FAILED'));try{resolve(JSON.parse(text));}catch{reject(fault('CONVERSION_RESPONSE'));}});
  });
}
function silenceWav(seconds=2){
  const samples=16000*seconds,out=Buffer.alloc(44+samples*2);
  out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(samples*2,40);return out;
}
const CONVERT=String.raw`import base64, importlib.util, io, json, pathlib, sys, wave
root = pathlib.Path(sys.argv[1]).resolve()
spec = importlib.util.spec_from_file_location('murmur_local', root / 'runtime' / 'local_inference.py')
runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
runner.configure_environment(root)
import av
from importlib.metadata import version
fixture = pathlib.Path(sys.argv[2]).resolve(); fixture.relative_to(root)
resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
chunks = []; size = 0; cap = 16000 * 11 * 2
with av.open(str(fixture)) as container:
    for frame in container.decode(audio=0):
        for output in resampler.resample(frame):
            chunk = output.to_ndarray().tobytes(); chunks.append(chunk); size += len(chunk)
        if size >= cap: break
    if size < cap:
        for output in resampler.resample(None): chunks.append(output.to_ndarray().tobytes())
pcm = b''.join(chunks)[:cap]
buffer = io.BytesIO()
with wave.open(buffer, 'wb') as wav:
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(pcm)
print(json.dumps({'wavBase64':base64.b64encode(buffer.getvalue()).decode('ascii'),'samples':len(pcm)//2,'sampleRate':16000,'channels':1,'bits':16,'versions':{'python':sys.version.split()[0],**{name:version(name) for name in ['av','numpy','onnxruntime','faster-whisper','ctranslate2']}}}))
`;
function writeReport(root,result){
  const reportPath=assertContained(root,path.join(root,'docs','TEST-LOCAL-INFERENCE.md'));
  const lines=['# Real offline local inference acceptance','',`Recorded: ${result.finishedAt || new Date().toISOString()}.`,'',
    'Command: `node scripts/verify-local-models.cjs`. This command does not download fixtures, weights or dependencies.','',
    `Result: **${result.checks.filter(row=>row.status==='PASS').length} passed, ${result.checks.filter(row=>row.status==='FAIL').length} failed**.`,'',
    '| Check | Result | Elapsed | Free RAM before → after |','| --- | --- | --- | --- |',
    ...result.checks.map(row=>`| ${row.name} | ${row.status}${row.code?` (${row.code})`:''} | ${(row.durationMs/1000).toFixed(2)} s | ${row.freeMemoryBeforeGB} → ${row.freeMemoryAfterGB} GiB |`),'',
    '## Earlier acceptance attempts','',
    ...(result.previousRuns.length?result.previousRuns.map(run=>`- ${run.startedAt}: CTranslate2 ${run.ctranslate2 || 'unknown'}; ${run.passed} passed / ${run.failed} failed. ${run.failures.map(failure=>`${failure.name}: ${failure.code}${failure.exitCodes.length?` (native exit ${failure.exitCodes.map(code=>`0x${Number(code).toString(16).toUpperCase()}`).join(', ')})`:''}`).join('; ') || 'No failed checks.'}`):['No earlier machine-readable acceptance attempt was available.']), '',
    ...(result.previousRuns.some(run=>run.ctranslate2==='4.7.1' && run.failures.some(failure=>failure.exitCodes.includes(3221225477)))?['The initial 4.7.1 runtime completed imports and NumPy audio conversion, then crashed with Windows access violation at `ctranslate2.models.Whisper` construction. A separate faulthandler diagnostic also reproduced this after clearing PYTHONHOME/PYTHONPATH and disabling the user site. The failure was recorded as 5 passing checks and 2 failed ASR checks before the project-only runtime update; it is not erased by later success. This observation does not prove the exact upstream defect responsible.','']:[]),
    '## Source and inputs','',
    `The existing [OpenAI Whisper JFK fixture](${FIXTURE.source}) is pinned to revision \`${FIXTURE.revision}\`, ${FIXTURE.bytes.toLocaleString('en-US')} bytes and Git blob \`${FIXTURE.gitBlob}\`. The driver verifies it before conversion. Its SHA256 is \`${result.fixture?.sha256 || 'not recorded'}\`. Missing or mismatched input fails; no replacement download occurs.`, '',
    result.audio?`PyAV converted ${result.audio.samples} samples (${result.audio.durationMs/1000} seconds) to 16 kHz mono PCM16 WAV in memory. Silence is a separate two-second all-zero WAV. Versions: ${Object.entries(result.audio.versions).map(([key,value])=>`${key} ${value}`).join(', ')}.`:'Audio conversion did not complete.', '',
    'ASR inference files and Silero ONNX are compared with the pinned project manifest before loading. File hashes and stage outputs are stored in ignored `artifacts/local-model-check/inference-results.json`. Qwen GGUF is not loaded; it still requires a separate local polish server.', '',
    '## Real execution and limits','',
    'All stages run serially through production `runLocal`/`runtime/local_inference.py`; ASR additionally uses production `createProviders`, a real isolated store and monitor trace. The literal `python` setting is resolved to project `.venv/Scripts/python.exe`. No production/user settings or history are changed. Test history and monitor files stay under `artifacts/local-model-check/inference-store`. No Electron, microphone, clipboard, keyboard helper or cloud/polish service participates.', '',
    'Python uses production `inferenceEnv`; the runner reasserts project-contained cache/temp directories, offline flags and socket denial. The driver also blocks Node HTTP/HTTPS/fetch calls. CPU runs int8; CUDA runs float16. Both use the inherited default PATH without a test-specific CUDA DLL override. A capability probe alone is not treated as successful GPU inference.', '',
    ...result.checks.filter(row=>row.transcript).map(row=>`- ${row.name}: ${JSON.stringify(row.transcript)}`),'',
    'Timings include process/model startup and do not establish steady-state throughput. The public English fixture is a limited functional check; Chinese speech quality, physical microphone capture, long sessions, arbitrary audio, real cloud APIs and local text-polish inference are not established. Structured errors are retained rather than replaced with demo text or a cloud fallback.', '',
  ];
  fs.writeFileSync(reportPath,lines.join('\n'),'utf8');
}
async function main(){
  const paths=createPaths(ROOT),folder=assertContained(ROOT,path.join(ROOT,'artifacts','local-model-check'));fs.mkdirSync(folder,{recursive:true});
  const lock=assertContained(ROOT,path.join(folder,'inference.lock')),owner=randomUUID();
  try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid,owner}),{flag:'wx',encoding:'utf8'});}catch{throw fault('INFERENCE_ALREADY_LOCKED');}
  const resultFile=assertContained(ROOT,path.join(folder,'inference-results.json'));
  const previous=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
  const previousRuns=previous?.checks?[...(previous.previousRuns || []),{startedAt:previous.startedAt,ctranslate2:previous.audio?.versions?.ctranslate2,passed:previous.checks.filter(row=>row.status==='PASS').length,failed:previous.checks.filter(row=>row.status==='FAIL').length,failures:previous.checks.filter(row=>row.status==='FAIL').map(row=>({name:row.name,code:row.code,exitCodes:[...new Set((row.processes || []).filter(item=>item.exitCode).map(item=>item.exitCode))]}))}]:[];
  const result={startedAt:new Date().toISOString(),previousRuns,fixture:{...FIXTURE},python:'.venv/Scripts/python.exe',cudaPath:'inherited default PATH; no extra DLL path',checks:[],modelFiles:[],audio:null};
  // Observe native termination only in this explicit public-fixture command.
  // Diagnostics stay in ignored artifacts; application stderr policy is unchanged.
  const processDiagnostics=[];
  childProcess.spawn=(...args)=>{
    const child=spawn(...args),diagnostic={exitCode:null,signal:null,stderr:''};
    processDiagnostics.push(diagnostic);
    child.stderr?.on('data',chunk=>{if(diagnostic.stderr.length<6000)diagnostic.stderr+=chunk.toString('utf8');});
    child.on('close',(code,signal)=>{diagnostic.exitCode=code;diagnostic.signal=signal;});
    return child;
  };
  const {createProviders,runLocal,resolvePython}=require('../core/providers.cjs');
  const output=()=>fs.writeFileSync(assertContained(ROOT,path.join(folder,'inference-results.json')),JSON.stringify(result,null,2)+'\n','utf8');
  const check=async(name,work)=>{
    const row={name,status:'FAIL',freeMemoryBeforeGB:memoryGB()},start=performance.now(),processStart=processDiagnostics.length;
    console.log(`Starting: ${name} (${row.freeMemoryBeforeGB} GiB RAM free)`);
    try{Object.assign(row,await work());row.status='PASS';}catch(error){row.code=error.code || error.name;}
    row.durationMs=Math.round(performance.now()-start);row.freeMemoryAfterGB=memoryGB();
    row.processes=clone(processDiagnostics.slice(processStart));result.checks.push(row);output();
    console.log(`Finished: ${name}: ${row.status}${row.code?` (${row.code})`:''}`);return row;
  };
  const forbidden=()=>{throw fault('NETWORK_FORBIDDEN');};
  const http=require('node:http'),https=require('node:https'),original={http:http.request,https:https.request,fetch:global.fetch};
  http.request=forbidden;https.request=forbidden;global.fetch=forbidden;
  try{
    const verified=await check('Pinned fixture and inference model hashes',async()=>{
      const fixture=assertContained(ROOT,path.join(folder,FIXTURE.name));if(!fs.existsSync(fixture))throw fault('FIXTURE_MISSING_PREPARE_PINNED_FILE');
      const actual=await hashes(fixture);assert.equal(actual.bytes,FIXTURE.bytes);assert.equal(actual.gitBlob,FIXTURE.gitBlob);Object.assign(result.fixture,actual);
      for(const id of ['whisper-small','silero-vad']){
        const model=manifest.find(item=>item.id===id);
        for(const file of model.files.filter(item=>!['README.md','LICENSE'].includes(item.name))){
          const filename=assertContained(paths.models,path.join(paths.models,model.directory,file.name));const actual=await hashes(filename);
          assert.equal(actual.bytes,file.size);if(file.sha256)assert.equal(actual.sha256,file.sha256);if(file.gitBlob)assert.equal(actual.gitBlob,file.gitBlob);
          result.modelFiles.push({model:id,file:file.name,...actual});
        }
      }
      assert.equal(resolvePython(paths,'python'),path.join(ROOT,'.venv','Scripts','python.exe'));
    });
    if(verified.status!=='PASS')return;
    let speech;
    const conversion=await check('Project PyAV offline audio conversion',async()=>{
      const converted=await pythonJSON(resolvePython(paths,'python'),CONVERT,paths,[ROOT,path.join(folder,FIXTURE.name)]);
      speech=Buffer.from(converted.wavBase64,'base64');const wav=validateWav(speech,converted.samples/16);
      assert(converted.samples>=16000);assert(converted.samples<=176000);
      result.audio={samples:converted.samples,durationMs:wav.durationMs,sampleRate:converted.sampleRate,channels:converted.channels,bits:converted.bits,versions:converted.versions};
    });
    if(conversion.status!=='PASS')return;
    const isolatedData=assertContained(ROOT,path.join(folder,'inference-store'));fs.mkdirSync(isolatedData,{recursive:true});
    for(const name of ['state.json','monitor.json']){const file=assertContained(ROOT,path.join(isolatedData,name));if(fs.existsSync(file)){assert(fs.statSync(file).isFile());fs.unlinkSync(file);}}
    const fixturePaths={...paths,data:isolatedData},store=createStore(fixturePaths);store.init();
    const monitor=createMonitor({paths:fixturePaths});monitor.init();
    const traced=async(work)=>{const id=monitor.begin({kind:'transcribe',trigger:'manual',route:'local'});try{const value=await work((stage,action)=>monitor.trace(id,stage,action));monitor.finish(id,'success');return value;}catch(error){monitor.finish(id,'failed',error.code);throw error;}};
    const vadModel=assertContained(paths.models,path.join(paths.models,manifest.find(item=>item.id==='silero-vad').directory,'silero_vad.onnx'));
    await check('Silero ONNX detects public speech',async()=>traced(async trace=>{const value=await trace('vad',()=>runLocal(paths,'python',{operation:'vad',modelPath:vadModel,audioBase64:speech.toString('base64')},60000));assert.equal(value.hasSpeech,true);return value;}));
    await check('Silero ONNX rejects two-second silence',async()=>traced(async trace=>{const value=await trace('vad',()=>runLocal(paths,'python',{operation:'vad',modelPath:vadModel,audioBase64:silenceWav().toString('base64')},60000));assert.equal(value.hasSpeech,false);return value;}));
    for(const device of ['cpu','cuda']){
      await check(`Production provider ${device==='cpu'?'CPU int8':'CUDA float16'} ASR`,async()=>{
        const settings=defaults();Object.assign(settings.asr,{modelId:'whisper-small',device,language:'en',pythonPath:'python'});settings.vad.mode='silero';settings.polish.mode='off';settings.general.autoCopy=false;settings.general.autoPaste=false;
        store.saveSettings(settings);
        const provider=createProviders({paths,store});
        const response=await traced(trace=>provider.transcribe({audio:speech,durationMs:result.audio.durationMs},{trace}));
        assert.equal(response.record.source,'local');assert.equal(response.record.model,'whisper-small');assert.equal(response.warnings.length,0);assert(response.text.trim().length>10);assert(/country/i.test(response.text));
        assert(store.getHistory().some(row=>row.id===response.record.id && row.text===response.text));
        return {transcript:response.text,recordId:response.record.id,device,computeType:device==='cpu'?'int8':'float16'};
      });
    }
    await check('Isolated history and content-free monitor trace',async()=>{
      const successes=result.checks.filter(row=>row.status==='PASS' && row.recordId).length;
      assert.equal(store.getHistory().length,successes);
      const tasks=monitor.snapshot().tasks;assert.equal(tasks.length,4);
      const providerTasks=tasks.filter(task=>task.stages.some(stage=>stage.name==='audio'));
      assert.equal(providerTasks.length,2);
      for(const task of providerTasks){assert(task.stages.some(stage=>stage.name==='vad'));assert(task.stages.some(stage=>stage.name==='asr'));}
      result.monitor={tasks,counters:monitor.snapshot().counters};result.historyCount=store.getHistory().length;
      const serialized=JSON.stringify(tasks);assert(!serialized.includes('audioBase64'));assert(!serialized.includes('rawText'));assert(!serialized.includes('modelPath'));
      for(const row of store.getHistory())assert(!serialized.includes(row.text));
      monitor.stop();
    });
  }finally{
    http.request=original.http;https.request=original.https;global.fetch=original.fetch;
    childProcess.spawn=spawn;
    result.finishedAt=new Date().toISOString();output();writeReport(ROOT,result);
    if(fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock,'utf8')).owner===owner)fs.unlinkSync(lock);
    if(result.checks.some(row=>row.status==='FAIL'))process.exitCode=1;
    console.log('Recorded results: docs/TEST-LOCAL-INFERENCE.md');
  }
}
if(require.main===module)main().catch(error=>{console.error(`Local verification failed: ${error.code || error.name}`);process.exitCode=1;});
module.exports={main,hashes,silenceWav};
