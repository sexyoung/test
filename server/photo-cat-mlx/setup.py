#!/usr/bin/env python3
"""Install the optional Apple Silicon MLX backend outside the repository."""
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request

CACHE = Path(os.environ.get('PHOTO_CAT_MLX_CACHE', str(Path.home() / 'Library/Caches/sunlit-photo-cat-mlx')))
COMMIT = '292331f4d26ddb80b9dcea6bcb5629ff82f12b82'
MODEL_SHA = '3cc66f3bea33e4062b7dbc875ffe1d70c4888914aec3e91b60f94e9bd01b522b'
MODEL = 'https://huggingface.co/zimengxiong/hunyuan3d-mlx-shape-small/resolve/main/'


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def main():
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        raise SystemExit('This optional backend requires an Apple Silicon Mac.')
    CACHE.mkdir(parents=True, exist_ok=True)
    uv = shutil.which('uv')
    if not uv:
        archive = CACHE / 'uv.tar.gz'
        urllib.request.urlretrieve('https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz', archive)
        with tarfile.open(archive) as tar:
            # Extract only the executable at its expected path.
            entry = tar.getmember('uv-aarch64-apple-darwin/uv')
            target = CACHE / 'uv'
            target.write_bytes(tar.extractfile(entry).read())
            target.chmod(0o755)
        uv = target
    run(uv, 'python', 'install', '3.12')
    python = CACHE / 'venv/bin/python'
    if not python.exists():
        run(uv, 'venv', '--python', '3.12', CACHE / 'venv')
    run(uv, 'pip', 'install', '--python', python, '-r', Path(__file__).with_name('requirements.txt'))
    runtime = CACHE / 'runtime'
    if not (runtime / '.git').exists():
        run('git', 'clone', 'https://github.com/ZimengXiong/Hunyuan3D-Swift.git', runtime)
    run('git', '-C', runtime, 'fetch', 'origin', COMMIT)
    run('git', '-C', runtime, 'checkout', '--detach', COMMIT)
    weights = CACHE / 'weights/shape-small'
    weights.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(MODEL + 'config.yaml', weights / 'config.yaml')
    checkpoint = weights / 'model.fp16.safetensors'
    if not checkpoint.exists():
        temporary = checkpoint.with_suffix('.download')
        print('Downloading public 3.82 GB shape weights; no photo leaves this Mac.', flush=True)
        run('curl', '-fL', '--retry', '3', '-C', '-', MODEL + checkpoint.name, '-o', temporary)
        temporary.rename(checkpoint)
    digest = hashlib.sha256()
    with checkpoint.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != MODEL_SHA:
        raise SystemExit('Checkpoint SHA256 mismatch; remove it and run setup again.')
    urllib.request.urlretrieve('https://huggingface.co/tencent/Hunyuan3D-2/raw/main/LICENSE', weights / 'LICENSE')
    run(python, '-c', 'import mlx.core as mx; print("MLX device:", mx.default_device()); print(mx.array([1,2])+1)')
    (CACHE / 'ready.json').write_text('{"backend":"hunyuan3d-2mini-mlx","verified_install":true}')
    print('Ready. Start: node server/photo-cat-mlx/server.mjs')


if __name__ == '__main__':
    main()
