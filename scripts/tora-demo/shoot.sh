#!/bin/bash
# shoot.sh <width> <height> <login> <password> <outDir(relative to mono-tora)> routes...
docker run --rm --network host --ipc host --user "$(id -u):$(id -g)" -e HOME=/tmp -e FULL -e BASE \
  -v $(cd "$(dirname "$0")/../.." && pwd):/work:ro -v $(cd "$(dirname "$0")" && pwd):/tora \
  mcr.microsoft.com/playwright:v1.64.1-noble node /tora/shoot.cjs "$1" "$2" "$3" "$4" "/tora/$5" "${@:6}"
