# Windows ASR crash: upstream research

Date: 2026-09-28. This is read-only source research, not a successful inference test or a root-cause determination. No package installation, environment modification, or model execution was performed for this research.

## Observed failure and scope

The integration team reported Windows status `0xC0000005` on both CPU and CUDA with CTranslate2 4.7.1 / faster-whisper 1.2.1. Imports and supported-compute-type inspection succeeded; Silero VAD succeeded. The team's faulthandler probe located the failure around the native Whisper constructor. The Whisper Small weight has passed its pinned official full SHA-256 check. Consult the integration test record for the actual command outputs; these observations were not independently rerun here.

## Findings from official sources

| Source | Actual scope | Relevance to this failure |
| --- | --- | --- |
| [CTranslate2 #2007](https://github.com/OpenNMT/CTranslate2/pull/2007/files), shipped in 4.7.1 | Windows DLL directory/import handling and CI | Import succeeds here, so this is not evidence of the constructor failure's cause. |
| [CTranslate2 #1912](https://github.com/OpenNMT/CTranslate2/pull/1912), shipped in 4.7.2 | Free CUDA curand state before thread destruction | A relevant Windows GPU cleanup fix, but not an explanation for CPU construction failure. |
| [CTranslate2 #2068](https://github.com/OpenNMT/CTranslate2/pull/2068/files), shipped in 4.8.1 | Model loader checks string length and tensor payload size before copying | Justifies preferring a current official build. The diff does not demonstrate that a valid, pinned Whisper model triggers this bug. |
| [CTranslate2 #2065](https://github.com/OpenNMT/CTranslate2/pull/2065) | Whisper alignment division by zero on very short windows | Different operation and exception (`0xC0000094`), so not a match for construction access violation. |
| [CTranslate2 4.8.2 release](https://github.com/OpenNMT/CTranslate2/releases/tag/v4.8.2) | Includes newer fixes, including further model/StorageView validation | A reasonable controlled candidate, not a verified cure. |

NumPy's [official troubleshooting guide](https://numpy.org/doc/stable/user/troubleshooting-importerror.html) describes native ABI incompatibility after a NumPy 2 upgrade, including potentially crashing extensions. However, the inspected CTranslate2 4.7.1 [StorageView binding](https://github.com/OpenNMT/CTranslate2/blob/v4.7.1/python/cpp/storage_view.cc) accesses the standard `__array_interface__` dictionary directly. Both [4.7.1](https://github.com/OpenNMT/CTranslate2/blob/v4.7.1/python/install_requirements.txt) and [4.8.2](https://github.com/OpenNMT/CTranslate2/blob/v4.8.2/python/install_requirements.txt) pin pybind11 2.11.1. That version number alone therefore does not establish a NumPy C API incompatibility in this code path. A crash before audio enters native inference further weakens that specific hypothesis; this does not rule out every other native dependency problem.

The [faster-whisper requirements](https://github.com/SYSTRAN/faster-whisper#gpu) identify current GPU dependencies as CUDA 12 cuBLAS and cuDNN 9. They recommend older CTranslate2 versions only for particular older CUDA/cuDNN stacks. Because CPU also fails here, a CUDA-only downgrade is not a justified first diagnosis.

## Recommended next step and limits

Use the complete official PyPI CTranslate2 4.8.2 wheel in the project-only environment, verify its published artifact hash, and change only that component for a controlled constructor and transcription check. Record import, constructor, actual segment iteration, and process exit separately. The native agent is handling this candidate; this research did not install or execute it. If it fails, preserve the native failure location and inspect the actually loaded DLL paths before additional version changes.

Repacking installed files preserves their current local bytes, not necessarily an upstream publisher's pristine wheel. A complete official artifact is therefore useful for testing binary provenance as well as version. Do not suppress duplicate-runtime errors, disable verification, or claim a fix based on import-only checks. No exact, confirmed upstream issue matching the observed CPU/CUDA constructor crash was found in the sources reviewed; absence from this bounded search is not proof that no such issue exists.
