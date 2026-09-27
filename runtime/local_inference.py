"""Offline, one-request JSON runner. No model names, downloads, or installers.

stdin: {root, operation: asr|vad, modelPath, audioBase64, language?, device?}
stdout: {ok: true, data: {text}|{hasSpeech}} or {ok: false, error: {code}}
Audio remains in memory. Optional inference libraries are imported only after
paths and input are validated; their output and exception details are suppressed.
"""

import base64
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import sys
import wave


class RunnerError(Exception):
    def __init__(self, code):
        self.code = code


def contained(base, candidate, must_exist=False):
    base = Path(base).resolve(strict=True)
    try:
        resolved = Path(candidate).resolve(strict=must_exist)
        resolved.relative_to(base)
    except (OSError, ValueError, RuntimeError):
        raise RunnerError("PATH_UNSAFE") from None
    return resolved


def configure_environment(root):
    cache = contained(root, root / "cache")
    cache.mkdir(parents=True, exist_ok=True)
    directories = {
        "HF_HOME": cache / "huggingface",
        "HUGGINGFACE_HUB_CACHE": cache / "huggingface" / "hub",
        "HF_HUB_CACHE": cache / "huggingface" / "hub",
        "TRANSFORMERS_CACHE": cache / "huggingface" / "transformers",
        "TORCH_HOME": cache / "torch",
        "XDG_CACHE_HOME": cache,
        "TEMP": cache / "tmp",
        "TMP": cache / "tmp",
        "TMPDIR": cache / "tmp",
        "NUMBA_CACHE_DIR": cache / "numba",
        "CUDA_CACHE_PATH": cache / "cuda",
    }
    for name, value in directories.items():
        directory = contained(root, value)
        directory.mkdir(parents=True, exist_ok=True)
        os.environ[name] = str(directory)
    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE",
                 "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK", "PYTHONDONTWRITEBYTECODE"):
        os.environ[name] = "1"
    for name in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "OPENAI_API_KEY"):
        os.environ.pop(name, None)
    sys.dont_write_bytecode = True

    def no_network(*_args, **_kwargs):
        raise RunnerError("LOCAL_INFERENCE")

    # Defense in depth against an optional library's hidden hub fallback.
    socket.create_connection = no_network
    socket.socket.connect = no_network
    socket.socket.connect_ex = no_network


def decode_audio(encoded):
    if not isinstance(encoded, str) or len(encoded) > 5600000:
        raise RunnerError("AUDIO_INVALID")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 4 * 1024 * 1024 or len(raw) < 44:
            raise ValueError("size")
        with wave.open(io.BytesIO(raw), "rb") as recording:
            if (recording.getnchannels() != 1 or recording.getsampwidth() != 2
                    or recording.getframerate() != 16000 or recording.getcomptype() != "NONE"
                    or not 4800 <= recording.getnframes() <= 1920000):
                raise ValueError("format")
            frames = recording.readframes(recording.getnframes())
            if len(frames) != recording.getnframes() * 2:
                raise ValueError("truncated")
        return frames
    except Exception:
        raise RunnerError("AUDIO_INVALID") from None


def validate_model(root, name, operation):
    if not isinstance(name, str) or not Path(name).is_absolute():
        raise RunnerError("PATH_UNSAFE")
    models = contained(root, root / "models", must_exist=True)
    model = contained(models, name)
    if not model.exists():
        raise RunnerError("MODEL_MISSING")
    if operation == "asr":
        if not model.is_dir():
            raise RunnerError("MODEL_INVALID")
        # Inspect every entry, including junctions and symlinks, before imports.
        for entry in model.rglob("*"):
            contained(models, entry, must_exist=True)
        for filename in ("model.bin", "config.json", "tokenizer.json"):
            file_path = contained(models, model / filename)
            if not file_path.is_file():
                raise RunnerError("MODEL_MISSING")
        # tokenizer.json is mandatory: faster-whisper otherwise fetches a hub tokenizer.
        vocabulary_paths = [contained(models, model / name) for name in ("vocabulary.txt", "vocabulary.json")]
        if not any(item.is_file() for item in vocabulary_paths):
            raise RunnerError("MODEL_MISSING")
    elif not model.is_file() or model.suffix.lower() != ".onnx":
        raise RunnerError("MODEL_INVALID")
    return model


def transcribe(model_path, frames, request):
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError:
        raise RunnerError("RUNTIME_MISSING") from None
    device = request.get("device", "cpu")
    language = request.get("language", "auto")
    if device not in ("cpu", "cuda") or language not in ("auto", "zh", "en"):
        raise RunnerError("REQUEST_INVALID")
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    model = WhisperModel(
        str(model_path), device=device,
        compute_type="int8" if device == "cpu" else "float16",
        local_files_only=True, download_root=os.environ["HF_HUB_CACHE"],
    )
    # VAD selection belongs to the main-process pipeline. Disable built-in VAD.
    segments, _info = model.transcribe(
        audio, language=None if language == "auto" else language,
        beam_size=3, vad_filter=False, condition_on_previous_text=False,
    )
    text = "".join(segment.text for segment in segments).strip()
    if len(text) > 20000:
        raise RunnerError("LOCAL_INFERENCE")
    return {"text": text}


def detect_speech(model_path, frames):
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        raise RunnerError("RUNTIME_MISSING") from None
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.log_severity_level = 4
    # Silero is a standalone ONNX file. Loading bytes denies resolution of
    # external tensor paths embedded in an untrusted ONNX file.
    session = ort.InferenceSession(model_path.read_bytes(), sess_options=options, providers=["CPUExecutionProvider"])
    if {item.name for item in session.get_inputs()} != {"input", "state", "sr"}:
        raise RunnerError("MODEL_INVALID")
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    state = np.zeros((2, 1, 128), dtype=np.float32)
    context = np.zeros((1, 64), dtype=np.float32)
    active = 0
    # Standard Silero ONNX at 16 kHz: 512 new samples plus 64-sample context.
    for offset in range(0, len(audio), 512):
        frame = audio[offset:offset + 512]
        if len(frame) < 512:
            frame = np.pad(frame, (0, 512 - len(frame)))
        window = np.concatenate((context, frame.reshape(1, 512)), axis=1)
        output, state = session.run(None, {"input": window, "state": state, "sr": np.array(16000, dtype=np.int64)})
        context = window[:, -64:]
        probability = float(np.asarray(output).reshape(-1)[0])
        if not 0.0 <= probability <= 1.0:
            raise RunnerError("MODEL_INVALID")
        active = active + 1 if probability >= 0.5 else 0
        if active >= 4:
            return {"hasSpeech": True}
    return {"hasSpeech": False}


def handle(request):
    if not isinstance(request, dict) or request.get("operation") not in ("asr", "vad"):
        raise RunnerError("REQUEST_INVALID")
    # Canonical root is the saved project containing this script, not cwd/stdin.
    root = Path(__file__).resolve(strict=True).parent.parent
    if not isinstance(request.get("root"), str) or Path(request["root"]).resolve() != root:
        raise RunnerError("PATH_UNSAFE")
    configure_environment(root)
    model_path = validate_model(root, request.get("modelPath"), request["operation"])
    frames = decode_audio(request.get("audioBase64"))
    if request["operation"] == "asr":
        return transcribe(model_path, frames, request)
    return detect_speech(model_path, frames)


def main():
    try:
        payload = sys.stdin.buffer.read(6000001)
        if len(payload) > 6000000:
            raise RunnerError("REQUEST_INVALID")
        request = json.loads(payload.decode("utf-8"))
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            data = handle(request)
        response = {"ok": True, "data": data}
    except RunnerError as error:
        response = {"ok": False, "error": {"code": error.code}}
    except (json.JSONDecodeError, UnicodeDecodeError):
        response = {"ok": False, "error": {"code": "REQUEST_INVALID"}}
    except Exception:
        response = {"ok": False, "error": {"code": "LOCAL_INFERENCE"}}
    sys.stdout.write(json.dumps(response, ensure_ascii=True, separators=(",", ":")))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
