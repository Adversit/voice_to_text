# 项目内本地模型与推理环境

用户已允许本轮下载模型。下载是显式准备操作；选择模型、开始录音不会下载模型或安装依赖。

## 准备命令

在项目目录运行：

```powershell
node scripts/download-models.cjs --all
node scripts/prepare-python.cjs
```

第一条只接受内置清单中的 `whisper-small`、`silero-vad`、`qwen-1.5b`，也可逐项执行。清单固定上游版本、文件大小与 SHA256 / Git blob 哈希。断点文件和校验收据都留在 `models/`；完整文件校验通过才正式采用。已有完整文件与清单不一致时停止，不覆盖用户文件。

第二条在项目 `.venv/` 创建隔离 Python 环境，固定安装 `faster-whisper==1.2.1`、`ctranslate2==4.8.2` 及必要依赖，包括 ONNX Runtime；不安装 Torch，不修改全局 Anaconda。pip 缓存和临时文件重定向到项目 `cache/`。可通过 `MURMUR_BOOTSTRAP_PYTHON` 指定用于创建环境的已有 Python。

Windows 建议显式选择带较新 MSVC 运行库的 CPython 3.12 x64 作为 `MURMUR_BOOTSTRAP_PYTHON`。本机旧 Anaconda 3.12.4 的 14.29 运行库能导入包，却在模型构造时崩溃；同样模型和依赖换到现成 CPython 3.12.14 后 CPU/CUDA 构造通过。不要仅根据导入成功判断语音识别可用，也不要修改系统 DLL。`.venv` 仍依赖创建它的基础 Python，基础解释器必须继续存在；迁移电脑时需重新准备环境。

安装结束还会实际导入本地运行库，成功后才报告环境就绪。已有完整项目 wheel 缓存时可以加 `--offline`。本机本轮为节省流量复用了部分已有 Python 包文件，在项目内重新打包并安装；复用包不声称重新从 PyPI 下载验真。CTranslate2 使用单独下载并通过 PyPI 官方 SHA256 的 4.8.2 wheel，不再复用曾在模型构造时崩溃的 4.7.1。来源和实际推理测试记录见下文。

下载器会互斥锁定每个资产，并对剩余下载和最终组装检查可用空间。异常退出后的陈旧锁不会自动删除：确认错误中显示的进程已结束后，只删除显示的 `.download-lock.json` 再重试；保留 `.part` 和 `.chunks` 可继续下载。校验失败的数据被隔离，不会成为可加载的完整模型。

## 文件位置与使用

- ASR：`models/asr/whisper-small/`，需要 `model.bin`、`config.json`、`tokenizer.json`、`vocabulary.txt`。只传绝对本地目录，不能把 Hub 模型名交给推理库。
- VAD：`models/vad/silero-vad/silero_vad.onnx`。现有离线入口要求标准有状态 ONNX，输入为 `input`、`state`、`sr`，音频 16 kHz；不是 sequence 变体。
- 润色：`models/polish/qwen-1.5b/qwen2.5-1.5b-instruct-q4_k_m.gguf`。文件下载完成不代表润色服务正在运行。后续用 `llama-server` 等服务显式指定该完整路径与项目缓存，再连接 loopback OpenAI 兼容 API；不能使用会自动下载的 `-hf` 参数。本次没有自动安装或启动该服务。

设置中的 Python 可填写项目 `.venv/Scripts/python.exe` 的完整路径；默认 `python` 优先使用存在的项目环境。CPU 使用 int8，CUDA 使用 float16。检测到显卡、找到 DLL、成功导入包和实际模型推理是不同验收阶段，以 [TEST-LOCAL-MODELS.md](../docs/TEST-LOCAL-MODELS.md) 为准。可用内存不足时应减少同时运行的模型与其他负载；应用不会终止其他程序。

`local_inference.py` 只接受一条 JSON 请求，录音留在内存，输出仅为结构化结果。模型路径必须位于本项目 `models/`，环境与缓存必须在项目内，网络被阻止；失败不会切换到云端。语音活动检测、识别和润色仍可分别配置。
