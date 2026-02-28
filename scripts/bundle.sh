#!/usr/bin/env bash
# Bundle the hallucination-detector plugin into a distributable .skill file (ZIP).
#
# Usage:
#   ./scripts/bundle.sh [output-directory]
#
# Output:
#   hallucination-detector.skill (ZIP archive) in the output directory (default: dist/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${1:-${REPO_ROOT}/dist}"

# Files and directories to include in the bundle
INCLUDE=(
    .claude-plugin
    .cursor-plugin
    .codex
    .opencode
    commands
    hooks
    scripts/hallucination-audit-stop.cjs
    README.md
    LICENSE
)

echo "📦 Bundling hallucination-detector plugin..."
echo "   Source: ${REPO_ROOT}"
echo "   Output: ${OUTPUT_DIR}"
echo

mkdir -p "${OUTPUT_DIR}"

BUNDLE_FILE="${OUTPUT_DIR}/hallucination-detector.skill"

# Remove old bundle if it exists
rm -f "${BUNDLE_FILE}"

# Create ZIP archive
cd "${REPO_ROOT}"
zip_args=()
for item in "${INCLUDE[@]}"; do
    if [ -e "${item}" ]; then
        if [ -d "${item}" ]; then
            zip_args+=(-r "${item}")
        else
            zip_args+=("${item}")
        fi
    else
        echo "⚠️  Skipping missing: ${item}"
    fi
done

zip -q "${BUNDLE_FILE}" "${zip_args[@]}"

echo "✅ Bundle created: ${BUNDLE_FILE}"
echo
echo "Contents:"
zipinfo -1 "${BUNDLE_FILE}" | sed 's/^/  /'
echo
SIZE=$(wc -c < "${BUNDLE_FILE}")
echo "Size: ${SIZE} bytes"
