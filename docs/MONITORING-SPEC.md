# 运行监控：实施契约

2026-09-27。用户追加应用运行监控。先实现系统资源、功能配置状态、任务各阶段耗时与失败。无模型下载、无遥测上传、无后台云端健康请求。外部服务只显示配置状态和最近实际任务结果，不把「配置完成」冒充「连接正常」。

## 两轮检查与状态源

第一轮链路：录音入口 → main 会话 → provider 的音频校验/VAD/ASR/润色 → clipboard/native delivery → 监控快照 → 监控页面。第二轮同时检查 preload 白名单、取消/短录音/权限失败、renderer 重载、重复快捷键、历史与导出、监控持久化、打包和测试。监控不修改转写历史 schema，不读取目标应用内容。

Electron main 中的 `core/monitor.cjs` 独占监控状态。前端只渲染快照，不能写入任务、耗时、资源数值。系统 CPU 使用率通过两次 os.cpus 累计时间差计算；初次为 null。系统内存来自 os；应用内存为 Electron 自有进程工作集之和（不含外部 Python/模型服务）；NVIDIA 使用系统已有 nvidia-smi，仅查询，不安装。未知数值显示未知，不填 0。

## 契约

`createMonitor({paths,onChange,getAppMemoryMB,now?,sampleResources?})` 返回：
- `init()`：读取独立 `data/monitor.json`；损坏/不支持版本保留原文件，在快照显示存储警告，不能阻断转写。
- `start()/stop()`：5 秒采样，串行不重叠；stop 清理 timer。NVIDIA 最多每 15 秒查询一次，2 秒超时。资源环形缓冲最多 60 项，不落盘。
- `sample()`：手动采样，同一时刻合并并发请求；`setPaused(boolean)` 仅暂停资源采样，任务记录继续。paused 仅当前进程生效，不改既有 settings schema。
- `begin({kind,trigger,route}) -> id`：任务 kind 为 transcribe/polish/demo；trigger 为 button/shortcut/manual；route 为 local/cloud/demo。内存和落盘记录白名单字段，忽略文本、路径、endpoint、key、目标窗口等额外字段。
- `stageStart(id,name)` / `stageEnd(id,name,status='success',errorCode?)`：阶段 preparing/recording/audio/vad/asr/polish/delivery；status running/success/failed/skipped/canceled/interrupted。时长来自 main 单调 elapsed 时间。重复/过期事件不重复计数。
- `trace(id,name,asyncAction)`：计时并在异常时记录已知错误码，再原样抛出；任务行为与返回值不变。监控存储失败永不改变原动作结果。
- `finish(id,status,errorCode?)`：任务状态 success/warning/failed/canceled/interrupted，最多保存最近 100 项。未完成任务重启后标为 interrupted。持久化为 schemaVersion=1 的原子 UTF-8 JSON，有大小/数量限制；路径必须通过 assertContained，不能回退 C 盘。
- `snapshot()`：`{schemaVersion:1,paused,intervalMs:5000,sampledAt:null|string,samples:[],tasks:[],alerts:[],storage:{persisted:boolean,message:string},counters:{completed,failed,canceled}}`。采样 `{at,cpuPercent:null|number,memoryUsedGB,memoryTotalGB,appMemoryMB:null|number,gpus:[{name,utilizationPercent:null|number,usedMB:null|number,totalMB:null|number}],gpuSampledAt:null|string}`。任务 `{id,createdAt,kind,trigger,route,status,durationMs,errorCode:null|string,stages:[{name,status,durationMs,errorCode:null|string}]}`；快照包含正在运行的 elapsed 时长。错误码只允许应用已知枚举，不存 error.message 或 stack。

Main 增补快照 `monitor`，附加 `health:[{id:'asr'|'vad'|'polish'|'shortcut'|'paste',state:'configured'|'missing'|'disabled'|'unavailable'|'ready',detail:string}]`，描述由当前配置/文件/注册/助手存在性生成。ready 仅用于实际已注册快捷键等确定状态，不用于推理服务。IPC `getMonitoring()`、`refreshMonitoring()`、`setMonitoring({paused:boolean})`，preload `onMonitoring(callback)` 订阅 `murmur:monitoring`。事件更新只重绘监控页，不能抢焦点或覆盖正在编辑的其他页。

Provider 追加可选第二参数 `{trace}`，`trace(name,action)` 由 main 绑定任务 id。音频校验、VAD、ASR、润色分段测量；润色失败必须先记录 failed 再走保留原文回退；关闭的阶段不记录（UI 显示未运行）。原接口调用不传 trace 时完全兼容。

录音 begin 创建任务并开始 preparing；recordingReady 结束 preparing、开始 recording；transcribe 结束 recording、复用任务 id。按钮/快捷键取消、权限失败、短录音、渲染进程丢失须结束任务，不留下永久 running。cancelRecording 增加可选 `reason` 枚举 canceled/microphone/short/error，前端不传自由文本。main 非录音 demo/polish 创建各自任务。delivery 只记录状态，不记录剪贴板或 transcript。

## 联动文件与清理

- core/monitor.cjs、tests/monitor.test.cjs、docs/TEST-MONITOR.md：资源、生命周期、持久化、隐私。
- core/providers.cjs、tests/providers.test.cjs：可选 trace，不复制原推理分支。
- desktop/main.cjs、desktop/preload.cjs：事件、会话、trace、生命周期、IPC 白名单。
- renderer/index.html、app.js、styles.css、icons.js：运行监控入口、资源趋势、功能配置状态、任务阶段列表、暂停/刷新；现有前端取消调用传 reason。
- desktop/smoke.cjs、README.md、agent.md、docs/TEST-RECORD.md、打包产物：集成与交付。

旧逻辑移除：监控页不复用静态 hardware 当实时读数；不要另建 renderer 轮询或独立任务状态；不加自动模型下载/重试/探活推理；不复制转写文本进诊断文件。通用历史 JSON/TXT 导出保持原用途；监控只保存脱敏诊断文件，不增加含密钥的诊断打包器。

## 验收与失败分支

1. 真实 Windows 采样可见，首个 CPU 为未知；GPU 不支持/超时为未知；低可用 RAM 以明确阈值提示，不能宣称模型性能。
2. 5 秒采样和 15 秒 GPU 间隔、暂停/恢复/退出、并发手动刷新均受控；监控服务失败不打断录音。
3. demo、成功转写、失败 ASR、润色回退、取消及粘贴跳过均准确记录状态/耗时；重启没有永远 running。
4. 文件最多 100 任务，资源最多 60 采样；不出现 transcript/rawText/audio/API Key/endpoint/HWND/异常原文；损坏、junction、只读路径均可见失败并保留转写主链路。
5. Node 测试、真实 Electron IPC/页面截图和最终 Windows 包集成结果写入测试记录。上轮用户按 Esc 停止 Computer Use；本轮继续用应用自身自动化测试，不操作其他用户窗口。

参考：[Electron ProcessMetric](https://www.electronjs.org/docs/latest/api/structures/process-metric)、[NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/index.html)。
