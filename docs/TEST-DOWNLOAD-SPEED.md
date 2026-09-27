# Small download-path probes

2026-09-28 (Asia/Shanghai). Read-only investigation of download routes; no system/proxy changes and no edits to the model download script or in-progress model assets. All probe files are under `cache/download-speed-probe/`. Existing process environment uses an HTTP CONNECT proxy at loopback port 7890 with no URL credentials. Curl 8.7.1 uses Schannel and HTTP/1.1. These short samples ran while other model downloads were active, so rates are indicative rather than sustained throughput claims.

## Official Hugging Face path

Pinned asset: Systran/faster-whisper-small `model.bin`, revision `536b0662742c02347bc0e980a01041f333bce120`. Each probe requested bytes 0–262143, bounded by 262144 bytes and 20 seconds. An official HEAD redirect resolved to `us.aws.cdn.hf.co`; signed query strings were kept in memory and not printed or written to the result record.

| Route | Result | Bytes received | Total seconds | Bytes/second | First byte seconds |
| --- | --- | ---: | ---: | ---: | ---: |
| HF resolve through current proxy | HTTP 206, 20s timeout | 108854 | 20.666 | 5267 | 13.048 |
| HF resolve without proxy | HTTP 206, complete | 262144 | 16.342 | 16041 | 13.919 |
| Already-resolved official CDN without proxy | HTTP 206, complete | 262144 | 12.092 | 21679 | 1.664 |
| Already-resolved official CDN through proxy | HTTP 206, complete | 262144 | 13.783 | 19019 | 2.331 |

Machine-readable metrics: `cache/download-speed-probe/results.json`. Resolving the official signed location once per asset can avoid repeated HF redirect latency; it does not remove the observed slow transfer rate. Expired signed URLs must be refreshed through the pinned HF source. These results do not justify changing system proxy configuration.

## Identical official Qwen asset on ModelScope

Official `Qwen/Qwen2.5-1.5B-Instruct-GGUF` repository metadata from ModelScope reports the exact same asset as the current HF manifest:

- Name: `qwen2.5-1.5b-instruct-q4_k_m.gguf`.
- Size: `1117320736` bytes.
- SHA-256: `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`.
- ModelScope file revision: `e8b19c78f775ccbcf6df15ceace6bb5276f09765`.
- [Pinned download source](https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/e8b19c78f775ccbcf6df15ceace6bb5276f09765/qwen2.5-1.5b-instruct-q4_k_m.gguf).
- [Official metadata API](https://modelscope.cn/api/v1/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/repo/files?Revision=master&Recursive=true).

Direct connection with proxy bypass limited to this probe: HTTP 206; 262144 bytes in 3.144448 seconds, 83367 bytes/second including redirect/startup; first byte 2.462100 seconds; one redirect to `cdn-lfs-cn-1.modelscope.cn`. Metadata and metrics are stored as `modelscope-metadata.json` and `modelscope-results.json` in the probe directory. This is an alternative transport for the same pinned hash, not a different quantization or unverified replacement. A complete transfer must still pass the existing full SHA-256 check before adoption. No complete weight file was downloaded by this probe.

Follow-up range 262144–1310719: HTTP 206; 1048576 bytes in 0.742352 seconds, 1412505 bytes/second including redirect/startup; first byte 0.533334 seconds. Metrics: `modelscope-1MiB-results.json`. The second sample demonstrates a materially faster reachable path (about 1.35 MiB/s over this short sample), not a promise of sustained speed for the full asset.

## Identical Whisper transfer candidates

ModelScope metadata probes found `model.bin` in `Systran/faster-whisper-small` at file revision `ace8b2ad9dee031c53b6371f6c3c918b5e4f1db9`, with size `483546902` and SHA-256 `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671`, exactly matching the official HF manifest. The ModelScope namespace alone is not proof of publisher verification; the pinned HF hash remains the authority for content. `pengzhendong/faster-whisper-small` also reports the same asset; `Xorbits` and `AI-ModelScope` candidates were not found. Only public metadata was fetched in these four queries, each capped at 128 KiB. Results: `cache/download-speed-probe/whisper-metadata-results.json`.

[Pinned Systran namespace transfer](https://modelscope.cn/models/Systran/faster-whisper-small/resolve/ace8b2ad9dee031c53b6371f6c3c918b5e4f1db9/model.bin). Existing small configuration/tokenizer files from HF need not change; accepting the complete model still requires the original full SHA-256 and size checks.

Direct Range 0–262143 from the pinned ModelScope URL: HTTP 206, 262144 bytes in 0.488623 seconds, 536495 bytes/second including setup; first byte 0.401262 seconds; redirect to `cdn-lfs-cn-1.modelscope.cn`. The sample itself is not a full-file hash verification. Metrics: `whisper-modelscope-results.json`. Total weight data across all probes so far: 2468150 bytes (about 2.36 MiB), plus small metadata JSON.

## Official transfer guidance

Hugging Face documents separate Hub/CDN hosts and chunk-based Xet transfers. Reusing a signed official CDN URL and concurrent Range transfers can reduce setup overhead; network bandwidth still bounds the result. Xet high-performance mode is intended for high-bandwidth machines with substantial RAM and is not evidence that this connection would become fast. No Xet package was installed during this investigation. [Download guide](https://huggingface.co/docs/hub/models-downloading), [environment settings](https://huggingface.co/docs/huggingface_hub/en/package_reference/environment_variables).

## Read-only invalid-checkpoint investigation

Later on 2026-09-28, a quarantined Whisper assembly and a newly completed `model.bin` were present. The new receipt reports the expected full-file SHA-256; this investigation did not independently rehash the complete file. No new network requests or changes to model/download files were made.

Two 64 KiB windows at offsets 0 and 8388608 were identical between the invalid assembly and the new file. A sparse comparison then read only 64-byte windows at the start, midpoint and end of each 512 KiB chunk: 177216 bytes per file, 2769 windows total. One window differed, at offset 185073600 (chunk starts at 184549376). All other sampled windows matched; unsampled bytes may still differ. The differing window contained nonzero data. Sanitized metrics: `cache/download-speed-probe/whisper-invalid-sparse-comparison.json`; no weight content was printed.

Static migration review: with valid old checkpoints aligned to 8 MiB and at most 8 MiB long, writing pieces for `position < oldLength` does not reach the next old checkpoint's starting offset. The first old block is shortened only after the later pieces have been written. These observations do not establish the cause of the original corruption; a byte mismatch in an interrupted checkpoint or earlier concurrent writes remains possible. Full hash rejection correctly prevented adoption of this invalid assembly.

Focused comparison of that one 512 KiB block found the first mismatch at absolute offset 185056955 and the last at 185073663: a 16709-byte span with 16459 differing bytes. The invalid assembly block exactly matches its quarantined checkpoint file, so the final assembly did not introduce this block's difference. Its first 15077 bytes from the mismatch repeat bytes 32768 positions earlier in the new valid block, but the complete 16709-byte tail does not match at that displacement. This is retained checkpoint corruption rather than a zero-filled hole; its precise origin remains unproven. Sanitized metrics: `whisper-invalid-chunk-comparison.json` and `whisper-invalid-tail-shift.json`. Only the selected 512 KiB block was read for this focused check; no complete weight content was read or printed. No network probe was needed after the fresh file became available.

## Probe cleanup

After diagnosis, the seven weight Range `.part` samples in `cache/download-speed-probe/` were removed. Each resolved absolute target was checked to be inside that directory and not a reparse point before removal. Small JSON metadata, timing/comparison summaries, and probe scripts remain; complete model files under `models/` were not changed by this cleanup. Thus no sampled model bytes are retained in the probe cache.
