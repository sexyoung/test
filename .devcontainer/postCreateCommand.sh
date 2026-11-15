#!/bin/bash
set -ex

npm i

curl -fsSL https://claude.ai/install.sh | bash

curl -fsSL https://chatgpt.com/codex/install.sh | sh