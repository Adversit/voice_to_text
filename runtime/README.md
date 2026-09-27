# 后续本地推理准备（本轮不执行）

目前不下载模型、不安装推理依赖。此文件说明用户之后允许下载时的准备方式。

1. 在项目 `.venv/` 创建独立 Python 环境；使用项目内 pip/cache 目录安装 `faster-whisper`。Silero ONNX 路径另需 `onnxruntime`。不要把模型名直接交给 `WhisperModel`，只能使用完整本地目录。
2. 将 `Systran/faster-whisper-base` 的完整文件放在 `models/asr/whisper-base/`。至少需要 `model.bin`、`config.json`、`tokenizer.json`、`vocabulary.txt` 或 `vocabulary.json`；保留仓库其余配置文件。其他大小对应 `whisper-tiny`、`whisper-small`、`whisper-medium`。
3. 在应用设置中选择 `.venv/Scripts/python.exe` 的完整路径，以及 CPU 或 CUDA。默认 CPU/int8。CUDA 依赖和性能需另外验证；检测出显卡不等于推理环境已就绪。
4. Silero 使用标准有状态 ONNX 模型（输入 `input`、`state`、`sr`），放在 `models/vad/silero-vad/silero_vad.onnx`。原型识别 16kHz 音频，暂不支持 sequence 变体。
5. 润色可运行 `llama-server` 一类兼容服务，使用本项目 `models/polish/` 的 GGUF 完整路径，并指定本项目的缓存目录。不要使用会自动从 Hub 下载模型的 `-hf` 参数。应用只连接已经运行的服务，配置中的 API 模型名需匹配服务实际提供的别名。
6. 若用 whisper.cpp 服务，同样预先用项目内模型完整路径启动服务，然后配置 `/inference` 前的基础地址。模型库的 faster-whisper 文件格式不能直接交给 whisper.cpp。

Python 入口通过标准输入接收一次 JSON 请求，标准输出仅返回结构化 JSON；录音不落盘。缺少文件、依赖、内存或不兼容模型都会明确失败，绝不自动换云端。

模型下载器、哈希校验、断点续传、可取消下载以及多模型同时加载预算留待下一阶段规格设计；当前代码没有下载入口。
