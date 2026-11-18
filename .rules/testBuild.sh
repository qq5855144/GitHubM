#!/bin/bash

VITE_TEMP="node_modules/.vite-temp"
if [ -L "$VITE_TEMP" ]; then
    rm "$VITE_TEMP"
    mkdir -p "$VITE_TEMP"
elif [ ! -e "$VITE_TEMP" ]; then
    mkdir -p "$VITE_TEMP"
fi

OUT_DIR="${TMPDIR:-/tmp}/githubm-test-build-$$"
rm -rf "$OUT_DIR"
OUTPUT=$(npx vite build --minify false --logLevel error --outDir "$OUT_DIR" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT"
fi

rm -rf "$OUT_DIR"
exit $EXIT_CODE
