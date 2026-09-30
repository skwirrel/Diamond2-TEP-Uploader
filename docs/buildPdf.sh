#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
count=0

# Typst documents (CDN-branded) take precedence: a foo.typ shadows foo.md.
for typ in "$DIR"/*.typ; do
  [ -f "$typ" ] || continue
  base="$(basename "${typ%.typ}")"
  case "$base" in cdn-style) continue ;; esac   # theme file, not a document
  pdf="${typ%.typ}.pdf"
  echo "Typesetting: $(basename "$typ") → $(basename "$pdf")"
  typst compile --root "$DIR/.." "$typ" "$pdf"
  count=$((count + 1))
done

# Editable Word copy of the user guide (from the markdown edition, CDN-styled
# via the reference doc). The TOC field needs updating once opened in Word.
echo "Converting: README_user.md → README_user.docx"
pandoc "$DIR/README_user.md" -o "$DIR/README_user.docx" \
  --reference-doc="$DIR/cdn-reference.docx" \
  --shift-heading-level-by=-1 --toc --toc-depth=2
count=$((count + 1))

# Remaining markdown docs go through pandoc/wkhtmltopdf as before.
for md in "$DIR"/*.md; do
  [ -f "$md" ] || continue
  [ -f "${md%.md}.typ" ] && continue
  pdf="${md%.md}.pdf"
  echo "Converting: $(basename "$md") → $(basename "$pdf")"
  pandoc "$md" -o "$pdf" --pdf-engine=wkhtmltopdf \
    --pdf-engine-opt=--enable-local-file-access \
    --metadata title="$(basename "${md%.md}")"
  count=$((count + 1))
done

echo "Done. $count file(s) converted."
