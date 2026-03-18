#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
count=0

for md in "$DIR"/*.md; do
  [ -f "$md" ] || continue
  pdf="${md%.md}.pdf"
  echo "Converting: $(basename "$md") → $(basename "$pdf")"
  pandoc "$md" -o "$pdf" --pdf-engine=wkhtmltopdf \
    --metadata title="$(basename "${md%.md}")"
  ((count++))
done

echo "Done. $count file(s) converted."
