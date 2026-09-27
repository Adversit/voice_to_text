"""Repack explicitly selected, already installed Python dependencies into local wheels.

Read-only source environments; writes only project cache/wheels. Used when the
official wheel download is slow. The target Python must match native wheel tags.
No Torch, models, or source-environment configuration is copied.
"""
import argparse
import base64
import csv
from email.parser import Parser
import hashlib
import importlib.metadata as metadata
import io
import json
from pathlib import Path
import shutil
import uuid
import zipfile

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name, parse_wheel_filename


def valid_wheel(file_path):
    """Check ZIP integrity and the included RECORD, not upstream provenance."""
    try:
        with zipfile.ZipFile(file_path) as archive:
            names = set(archive.namelist())
            records = [name for name in names if name.endswith(".dist-info/RECORD")]
            if len(records) != 1 or archive.testzip() is not None:
                return False
            prefix = records[0].rsplit("/", 1)[0]
            if not {prefix + "/WHEEL", prefix + "/METADATA"}.issubset(names):
                return False
            for name, digest, size in csv.reader(io.StringIO(archive.read(records[0]).decode("utf-8"))):
                if name not in names:
                    return False
                content = archive.read(name)
                if size and len(content) != int(size):
                    return False
                if digest:
                    algorithm, expected = digest.split("=", 1)
                    actual = base64.urlsafe_b64encode(hashlib.new(algorithm, content).digest()).rstrip(b"=").decode("ascii")
                    if actual != expected:
                        return False
        return True
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, csv.Error):
        return False


def write_atomic(output, project, writer):
    output.resolve().relative_to(project)
    temporary = output.with_name(output.name + ".tmp-" + uuid.uuid4().hex)
    temporary.resolve().relative_to(project)
    try:
        writer(temporary)
        if not valid_wheel(temporary):
            raise RuntimeError("Repacked wheel failed ZIP/RECORD integrity: " + output.name)
        output.resolve().relative_to(project)
        temporary.replace(output)
    finally:
        temporary.resolve().relative_to(project)
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--pure-source", required=True)
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    destination = (project / "cache" / "wheels").resolve()
    destination.relative_to(project)
    destination.mkdir(parents=True, exist_ok=True)
    source = Path(args.source).resolve(strict=True)
    pure_source = Path(args.pure_source).resolve(strict=True)
    regular = {canonicalize_name(d.metadata["Name"]): d for d in metadata.distributions(path=[str(source)])}
    pure = {canonicalize_name(d.metadata["Name"]): d for d in metadata.distributions(path=[str(pure_source)])}
    chosen = {}
    bundled = {}
    queue = [Requirement("faster-whisper==1.2.1"), Requirement("ctranslate2==4.8.2")]
    environment = {**default_environment(), "extra": ""}
    while queue:
        requirement = queue.pop()
        if requirement.marker and not requirement.marker.evaluate(environment):
            continue
        name = canonicalize_name(requirement.name)
        if name in bundled:
            if not requirement.specifier.contains(bundled[name][1]):
                raise RuntimeError("Incompatible bundled dependency: " + name)
            continue
        if name in chosen:
            if not requirement.specifier.contains(chosen[name].version):
                raise RuntimeError("Incompatible installed dependency: " + name)
            continue
        if name == "torch":
            raise RuntimeError("Unexpected Torch dependency")
        if name == "ctranslate2":
            # The old local 4.7.1 build imported but crashed during model load.
            # Reuse only the exact official replacement wheel, never repack it.
            wheel = destination / "ctranslate2-4.8.2-cp312-cp312-win_amd64.whl"
            wheel.resolve().relative_to(project)
            if not wheel.is_file() or wheel.stat().st_size != 19222069:
                raise RuntimeError("Prepare the official CTranslate2 4.8.2 cp312 Windows wheel in project cache/wheels first.")
            with wheel.open("rb") as source_file:
                digest = hashlib.file_digest(source_file, "sha256").hexdigest()
            if digest != "d94421d565d0de61c032998f737a18942b0f2bef40c0424b1846ec6f67300105":
                raise RuntimeError("Official CTranslate2 wheel SHA256 mismatch")
            with zipfile.ZipFile(wheel) as archive:
                wheel_metadata = Parser().parsestr(archive.read("ctranslate2-4.8.2.dist-info/METADATA").decode("utf-8"))
            bundled[name] = (wheel, "4.8.2")
            queue.extend(Requirement(item) for item in wheel_metadata.get_all("Requires-Dist", []))
            continue
        if name == "setuptools":
            for wheel in (pure_source.parent / "ensurepip" / "_bundled").glob("setuptools-*.whl"):
                wheel_name, version, _build, _tags = parse_wheel_filename(wheel.name)
                if requirement.specifier.contains(version):
                    write_atomic(destination / wheel.name, project, lambda temporary: shutil.copyfile(wheel, temporary))
                    bundled[name] = (wheel, str(version))
                    break
            if name in bundled:
                continue
        dist = pure.get(name) if name == "faster-whisper" else regular.get(name)
        if dist is not None and not dist.read_text("WHEEL"):
            alternate = pure.get(name)
            if alternate is not None and alternate.read_text("WHEEL") and not any(str(f).endswith((".pyd", ".dll")) for f in alternate.files):
                dist = alternate
        if dist is None or not requirement.specifier.contains(dist.version):
            raise RuntimeError("No matching installed dependency: " + str(requirement))
        if name == "faster-whisper" and any(str(f).endswith((".pyd", ".dll")) for f in dist.files):
            raise RuntimeError("Cross-Python source must be pure Python")
        chosen[name] = dist
        queue.extend(Requirement(item) for item in (dist.requires or []))

    reports = [{"name": name, "version": value[1], "bundledWheel": True} for name, value in bundled.items()]
    for name, dist in sorted(chosen.items()):
        wheel_info = dist.read_text("WHEEL")
        if not wheel_info:
            raise RuntimeError("No reusable wheel metadata: " + name)
        tags = [line.split(":", 1)[1].strip() for line in wheel_info.splitlines() if line.startswith("Tag:")]
        if not tags:
            raise RuntimeError("Installed dependency has no wheel tag: " + name)
        tag = next((value for value in tags if not value.startswith("py2-")), tags[0])
        wheel_name = f"{dist.metadata['Name'].replace('-', '_')}-{dist.version}-{tag}.whl"
        output = destination / wheel_name
        output.resolve().relative_to(project)
        if output.exists() and valid_wheel(output):
            reports.append({"name": name, "version": dist.version, "reusedWheel": True})
            continue
        rows = []
        base = Path(dist.locate_file("")).resolve()
        dist_info = Path(dist._path).name
        def build(temporary):
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
                for item in dist.files:
                    relative = str(item).replace("\\", "/")
                    if relative.startswith("../") or relative.endswith(".pyc") or relative == f"{dist_info}/RECORD":
                        continue
                    file_path = Path(dist.locate_file(item)).resolve(strict=True)
                    file_path.relative_to(base)
                    if not file_path.is_file():
                        continue
                    content = file_path.read_bytes()
                    archive.writestr(relative, content)
                    digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode("ascii")
                    rows.append((relative, "sha256=" + digest, len(content)))
                rows.append((f"{dist_info}/RECORD", "", ""))
                record = io.StringIO(newline="")
                csv.writer(record).writerows(rows)
                archive.writestr(f"{dist_info}/RECORD", record.getvalue())
        write_atomic(output, project, build)
        reports.append({"name": name, "version": dist.version, "bytes": output.stat().st_size})
    print(json.dumps(reports))


if __name__ == "__main__":
    main()
