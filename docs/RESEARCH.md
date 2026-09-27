# 同类项目调研与本项目取舍

调研时间：2026-09-27。通过官方仓库和上游文档阅读，没有克隆大仓库或下载模型。以下是架构借鉴，本项目代码独立实现。

| 项目 | 已查证的实现方式 | 本项目采用的思路与取舍 |
| --- | --- | --- |
| [Handy](https://github.com/cjpais/Handy) | Tauri/Rust 桌面应用；全局快捷键；Silero VAD 与多种本地识别模型；剪贴板输入；说明了焦点和剪贴板恢复的竞态问题 | 将 VAD 与 ASR 独立配置，区分录音和推理状态。原型先复制结果，由用户粘贴，避免未验证的跨应用焦点控制。其 AppData 模型路径不符合本项目约束，因此使用项目专属目录 |
| [OpenWhispr](https://github.com/OpenWhispr/openwhispr) | Electron 桌面应用，支持本地 Whisper/Parakeet 与自带 Key 的云端路径；包含托盘、历史及模型管理 | 采用 Electron 隔离主进程与渲染器，并抽出服务适配器。原型不引入 React/SQLite 构建依赖，也不采用首次使用自动下载方式 |
| [Echo](https://github.com/GithubPhobos/Echo) | Windows 离线语音助手，Whisper.net、VAD、快捷键和光标输入 | 将 Windows 桌面行为作为真正的功能模块；硬件建议、录音失败和后台快捷键必须独立验收 |

## 接口与运行时依据

- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)：sandbox、context isolation、限定 IPC、CSP、自定义协议；不把 Node 或任意 IPC 发给 UI。
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)：preload 暴露具名最小接口，状态与凭据由主进程拥有。
- [faster-whisper 本地模型加载](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py)：使用本地目录及 `local_files_only`，辅以离线环境变量；模型不存在时直接失败。
- [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/server.cpp)：本地 `/inference` 接收 multipart 音频和 JSON 输出格式。
- [Silero VAD](https://github.com/snakers4/silero-vad)：本地 ONNX 语音检测；可选依赖和权重未安装时明确提示。
- [Qwen2.5-1.5B GGUF](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF)：文本润色候选。只记录模型信息和路径，本项目不执行上游示例中的下载命令。

## 适用边界

模型内存/显存建议是保守估计，受量化格式、上下文、推理引擎和同时运行的软件影响。检测到 NVIDIA 不代表 CUDA 推理依赖已经可用。中文识别质量和端到端延迟需待用户允许下载模型后实测。

未复制上述项目代码；未来若引入其实现或资源，必须针对实际采用版本核对许可证并保留归属。
