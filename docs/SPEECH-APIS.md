# 语音 API 接入说明

接口资料核对：2026-09-27；实现记录：2026-09-28。已准备硅基流动、阿里云百炼、OpenAI、Groq 和自定义兼容服务。当前验证使用本地响应夹具，没有向真实语音 API 发送录音；账户开通、额度、地区可用性和实际识别效果仍需用户填写密钥后验证。

## 配置与调用

在设置中将语音转写切换到云端，选择服务商、官方地址或地域、模型，再填写该服务商的 API 密钥。可以先不填密钥保存配置；此时开始转写会在发出请求前提示缺少密钥。API 模型名称可手动修改，但必须与所选服务的协议匹配。

密钥通过 Windows Electron safeStorage 加密保存，并绑定服务商和地址。修改自定义主机或百炼地域后，不会把旧地址的密钥发往新地址；切换服务商也不会沿用另一家的密钥。每家保存一个地址绑定；更换地域可能需要重新填写。程序不检查余额、不进行后台健康探测，也不自动重试收费请求。

录音仍由应用先校验为单声道、16 kHz、PCM16 WAV，单次 0.3–120 秒、最多 4 MiB。请求使用 HTTPS、Bearer 密钥和 90 秒超时；不跟随重定向；响应最多 1 MiB，文字最多 20000 字符。服务失败不会将响应正文或密钥写入历史、导出或监控。历史仍只记录原有的文字、模型、来源、时间、警告和回填结果。

| 服务 | 默认模型 | 官方基础地址 | 本项目请求协议 |
| --- | --- | --- | --- |
| 硅基流动 | `FunAudioLLM/SenseVoiceSmall` | `https://api.siliconflow.cn/v1` | `/audio/transcriptions`，multipart 文件和模型 |
| 阿里云百炼 | `qwen3-asr-flash` | `https://dashscope.aliyuncs.com/compatible-mode/v1`；新加坡为 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `/chat/completions`，JSON 音频输入 |
| OpenAI | `gpt-transcribe` | `https://api.openai.com/v1` | `/audio/transcriptions`，multipart |
| Groq | `whisper-large-v3-turbo` | `https://api.groq.com/openai/v1` | `/audio/transcriptions`，multipart |
| 自定义 | 示例 `whisper-1` | 用户填写 HTTPS 地址 | OpenAI 文件转写 multipart 协议 |

## 服务协议依据

硅基流动文档列出的请求字段为 `file` 和 `model`，返回 `text`。目录还提供 `TeleAI/TeleSpeechASR`；本项目不发送该接口未列出的 `language` 或 `response_format`。官方限制为一小时、50 MB，应用自身限制更小。[语音转写接口](https://docs.siliconflow.cn/docs/api/audio-transcriptions-post)；[创建密钥](https://cloud.siliconflow.cn/account/ak)。

百炼 Qwen ASR Flash 使用 `messages[].content[].input_audio.data`，内含 `data:audio/wav;base64,...`，同时发送 `stream:false` 和 `asr_options:{enable_itn:false}`。显式选择中文或英文时增加 `asr_options.language`；自动识别时省略。结果读取 `choices[0].message.content`。官方限制为五分钟、10 MB，大小包含 Base64；两分钟 PCM WAV 编码后约 5.12 MB。文档推荐业务空间专属域名，同时保留上述 DashScope 公共域名；本版只列出这两个已确认的公共地址。北京与新加坡密钥不同。其他百炼实时或长音频模型可能采用不同协议，不属于此适配器。[Qwen ASR API](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)；[获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)。

OpenAI 接口发送 `file`、`model`、`response_format=json`。`gpt-transcribe` 使用复数 `languages[]`；`gpt-4o-transcribe`、`gpt-4o-mini-transcribe` 和 `whisper-1` 使用单数 `language`；自动识别时均省略。结果读取 `text`。文件上传限制为 25 MB。本版未提供流式、翻译、说话人分离或关键词提示控件；手动输入需要其他参数的模型不保证适配。[文件转写指南](https://developers.openai.com/api/docs/guides/speech-to-text)；[API 参数](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)；[创建密钥](https://platform.openai.com/api-keys)。

Groq 使用 OpenAI 兼容文件转写，提供 `whisper-large-v3-turbo` 和 `whisper-large-v3`。发送 `file`、`model`、`response_format=json`，可选 `language`；结果读取 `text`。官方直接附件上限为 25 MB，应用两分钟录音低于此限制。[语音转写文档](https://console.groq.com/docs/speech-to-text)；[创建密钥](https://console.groq.com/keys)。

自定义选项仅代表兼容 `/audio/transcriptions` 文件转写协议，不表示所有厂商的语音 API 都兼容。它接受基础地址或以 `/audio/transcriptions` 结尾的完整地址；示例地址来自 OpenAI，需要自行改为实际服务地址。需要 WebSocket、签名认证、异步任务或音频聊天的其他服务应使用独立适配器。

## 代码与验证边界

`core/speech-apis.cjs` 管理公开目录和官方地址约束，两个 getter 返回独立副本，未知 ID 返回 `null`；`validateProviderEndpoint(provider, endpoint)` 返回规范 HTTPS 地址，失败抛出 `code=INVALID_SETTINGS` 的普通 Error，避免 schema 循环依赖。

`core/cloud-asr.cjs` 的 `buildCloudAsrRequest({settings,audio,key})` 接收完整设置和 `validateWav` 返回值，返回 `{url:URL,body:Buffer,headers,parseResponse}`。构建器不发请求，解析器只返回规范文字。`core/providers.cjs` 复用原有受限传输、VAD、润色、历史和阶段监控；本地失败不会切换到云端。

本地 Python 设置保持 `python` 时，启动器优先使用项目 `.venv/Scripts/python.exe`（Windows）或 `.venv/bin/python`（其他系统），存在时须通过项目路径约束；不存在则保留 `python`。明确填写的自定义解释器不被替换。这只是解释器选择，依赖和模型是否实际可用由独立模型准备报告说明。

自动化验证记录见 [TEST-SPEECH-APIS.md](TEST-SPEECH-APIS.md)。真实云端认证、服务可达性、计费及转写质量没有在本轮夹具测试中验证。
