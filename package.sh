#!/usr/bin/env bash
# Chrome Web Store 提出用の ZIP を作る。
# extension/ の「中身だけ」を固め、開発用ファイル・個人データは除外する。
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' extension/manifest.json | sed 's/.*"\([^"]*\)"$/\1/')
OUT="oshi-mado-${VERSION}.zip"

# 必須アセットの確認。空ファイル（アイコンの仮置き）も欠落として扱う。
# -f だけだと 0 バイトの仮置きを通してしまい、壊れた ZIP ができる。
missing=0
for f in extension/manifest.json extension/popup.html extension/popup.js \
         extension/options.html extension/options.js extension/styles.css \
         extension/icons/icon16.png extension/icons/icon32.png \
         extension/icons/icon48.png extension/icons/icon128.png; do
  [ -s "$f" ] || { echo "欠落または空: $f"; missing=1; }
done

# manifest.json に icons が入っているか（仮置きのまま提出するのを防ぐ）
grep -q '"icons"' extension/manifest.json || {
  echo "欠落: manifest.json の icons 定義"; missing=1;
}
[ "$missing" -eq 0 ] || { echo "必要なファイルが揃っていません。中止します。"; exit 1; }

rm -f "$OUT"
(
  cd extension
  # README.md（開発者向け）と dotfile は配布物に含めない。
  # 'README.md' だけではトップレベルしか外れず icons/README.md が残るため '*README.md' で拾う。
  zip -r -q "../$OUT" . -x '*README.md' -x '.*' -x '*/.*'
)

echo "作成: $OUT"
unzip -l "$OUT"
