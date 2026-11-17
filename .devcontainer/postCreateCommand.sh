#!/bin/bash
set -ex

# Mac host Blender over SSH (scripts/blender)
if [ -d "$HOME/.devcontainer-ssh" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  cp "$HOME/.devcontainer-ssh/"* "$HOME/.ssh/"
  chmod 600 "$HOME/.ssh/id_ed25519" "$HOME/.ssh/known_hosts" 2>/dev/null || true
fi
mkdir -p "$HOME/.local/bin"
ln -sf "$PWD/scripts/blender" "$HOME/.local/bin/blender"

npm i

curl -fsSL https://claude.ai/install.sh | bash

curl -fsSL https://chatgpt.com/codex/install.sh | sh