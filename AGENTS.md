> 最終更新: 2026-09-07（Mon）09:13

# AGENTS.md — 推し窓（oshi-mado）

登録したYouTubeチャンネルの直近7日の投稿を収集し、種類別に表示するChrome拡張機能です。旧GAS版は `_Archives/oshi-mado-gas/` に退避済みで、このリポジトリでは `extension/` が本体です。

## 確認と配布

```bash
node --check extension/popup.js
node --check extension/options.js
bash -n package.sh
bash package.sh  # 配布ZIPを作る場合だけ
```

Chromeでの確認は `chrome://extensions` から `extension/` を読み込み、コード変更後に拡張機能をリロードします。`bash package.sh` は成果物を作るため、構文確認だけなら実行しません。

## 実行時データ

- `chrome.storage.sync`：`channels` と `apiKey`
- `chrome.storage.local`：`videoCache`
- 新着発見：YouTube公開RSS
- 種類判定と配信時刻：YouTube Data API v3。APIキーが無ければ新着一覧だけを表示します。

APIキーはユーザーが設定画面から保存するruntime値です。ファイル、ログ、コミットへ書きません。

## 主要ファイル

| パス | 役割 |
|---|---|
| `extension/manifest.json` | Manifest V3定義、version、権限、通信先 |
| `extension/popup.js` | RSS収集、種類判定、タブとチャンネル絞り込み |
| `extension/options.js` | チャンネルとAPIキーの設定 |
| `extension/popup.html` / `extension/options.html` | 画面構造 |
| `extension/styles.css` | ダーク・ライト両対応の表示 |
| `extension/icons/` | 配布用PNG |
| `oshi_mado_icons/` | SVG原本。配布ZIPには入らない |
| `PRIVACY.md` | 保存データと通信先の公開説明 |

## 壊しやすい前提

- 投稿の絞り込みはチャンネルだけです。日付は見出しのグルーピングであり、日付・時刻フィルタはありません。
- Shortsは公式フラグがないため、URLまたは60秒以下の近似です。3分Shortsを完全には判定できません。
- 「動画をアプリで開く」設定は拡張機能内にありません。`openInApp`等の未実装設定を文書へ書きません。
- 開始予定時刻が無い配信枠は公開時刻へフォールバックします。
- サムネイルは `i.ytimg.com` から読みます。画像表示にhost permissionは不要ですが、通信先の説明では数えます。
- チャンネルの「外す」と「追加」は保存ボタンを押すまで確定しません。未保存のまま設定画面を閉じようとすると `beforeunload` で確認ダイアログが出ます（APIキー欄の未保存も同じ扱い）。
- RSS が落ちたチャンネルはポップアップ上部の `#failed` 帯に ID で並びます。落ちた回は名前を取得できないため ID 表示です。各 ID はチャンネルページへのリンクで、`title` 属性に失敗理由が入ります。表示は `FAILED_SHOWN`（8件）までで超過分は「ほかN件」、全件は `console.warn` に出ます。失敗0件のときは帯を `hidden` にします。
- 直近7日の絞り込みは RSS の `published`（枠を立てた時刻）で種類判定より前に掛かります。そのため8日以上前に立てた配信枠は、配信中でも一覧に出ません。**これは仕様として許容します**（2026-09-07 判断）。修正提案を出さないでください。
- 種類判定は `upcoming`、`live`、`archive`、`short`、`video` の5種です。

## 公開文書との整合

データの保存場所、通信先、権限、画面機能を変えた場合は、`README.md`、`PRIVACY.md`、およびストア掲載文（作業ノート側で管理）を実装と照合します。存在しない日付・時刻フィルタや `openInApp` を説明へ戻さないでください。

## 完了条件

- 変更したJavaScriptの `node --check` と `bash -n package.sh` が通る。
- `manifest.json` のversion、権限、通信先と公開文書が一致する。
- storageやAPI通信を変えた場合は、Chrome実機確認の要否を報告する。
