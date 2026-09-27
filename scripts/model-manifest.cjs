'use strict';

// Curated immutable upstream revisions. Large-file SHA256 comes from official
// Hugging Face LFS metadata; gitBlob is the upstream Git object SHA1.
module.exports = Object.freeze([
  {
    id: 'whisper-small', directory: 'asr/whisper-small', license: 'MIT',
    source: 'https://huggingface.co/Systran/faster-whisper-small',
    revision: '536b0662742c02347bc0e980a01041f333bce120',
    base: 'https://huggingface.co/Systran/faster-whisper-small/resolve/536b0662742c02347bc0e980a01041f333bce120/',
    files: [
      { name: 'config.json', size: 2370, gitBlob: 'e5047537059bd8f182d9ca64c470201585015187' },
      { name: 'tokenizer.json', size: 2203239, gitBlob: '7818adb6de9fa3064d3ff81226fdd675be1f6344' },
      { name: 'vocabulary.txt', size: 459861, gitBlob: 'c9074644d9d1205686f16d411564729461324b75' },
      { name: 'README.md', size: 1998, gitBlob: '16511f6106ead2fbc3a1480957a217c2661a5a98' },
      { name: 'model.bin', size: 483546902, sha256: '3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671',
        url: 'https://modelscope.cn/models/Systran/faster-whisper-small/resolve/ace8b2ad9dee031c53b6371f6c3c918b5e4f1db9/model.bin',
        downloadRevision: 'ace8b2ad9dee031c53b6371f6c3c918b5e4f1db9',
      },
    ],
  },
  {
    id: 'silero-vad', directory: 'vad/silero-vad', license: 'MIT',
    source: 'https://github.com/snakers4/silero-vad',
    revision: '5cd7945676eb32225748052e2e6a0580e4686a08',
    base: 'https://raw.githubusercontent.com/snakers4/silero-vad/5cd7945676eb32225748052e2e6a0580e4686a08/',
    files: [
      { name: 'LICENSE', remote: 'LICENSE', size: 1075, gitBlob: '0bf5e90cac691b999d4a35044f97167d7bbbf0b9' },
      { name: 'silero_vad.onnx', remote: 'src/silero_vad/data/silero_vad.onnx', size: 2327524, gitBlob: '80c5592ef1f4c9ede3e357bbd02eb863358a6a9d' },
    ],
  },
  {
    id: 'qwen-1.5b', directory: 'polish/qwen-1.5b', license: 'Apache-2.0',
    source: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    revision: '91cad51170dc346986eccefdc2dd33a9da36ead9',
    base: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/',
    files: [
      { name: 'LICENSE', size: 11343, gitBlob: '6634c8cc3133b3848ec74b9f275acaaa1ea618ab' },
      { name: 'README.md', size: 4856, gitBlob: 'c6d9d97367083098b753d8960ac8b4a76d81039f' },
      { name: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', size: 1117320736, sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
        url: 'https://modelscope.cn/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/e8b19c78f775ccbcf6df15ceace6bb5276f09765/qwen2.5-1.5b-instruct-q4_k_m.gguf',
        downloadRevision: 'e8b19c78f775ccbcf6df15ceace6bb5276f09765',
      },
    ],
  },
]);
