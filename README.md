# 家事記録・労いBot (KajiBot)

Discord と Google Spreadsheet を連携させた、家事記録 & ポイント管理Botです。
サーバーレス（Google Apps Script + Cloudflare Workers）で動作し、無料で運用可能です。

## 機能
- **家事の記録**: Discordのボタンを押すだけで、誰が・いつ・何をしたかをスプレッドシートに記録。
- **2階層メニュー**: カテゴリ選択 → タスク選択の2ステップで、多くの家事をスッキリ整理。
- **ポイント管理**: タスクごとにポイントを設定し、自動集計。
- **労い & 清算機能**:
    - **Gap表示**: 夫婦（パートナー）間のポイント差を可視化。
    - **メッセージ**: ポイント差に応じて「スイーツ推奨」「マッサージ献上」などのメッセージが変化（カスタマイズ可能）。
    - **清算（Redemption）**: 労い（ご馳走など）をすることで、ポイント差をリセットまたはマイナスする機能。
- **完全データ管理**: 家事のメニュー、ポイント、労いメッセージ設定など、全て**スプレッドシート側で変更可能**。コード修正は不要です。

## 構成
- **Discord**: ユーザーインターフェース（ボタン、コマンド）。
- **Cloudflare Workers**: Discordとの通信、署名検証、メニューの動的生成、リワードロジック。
- **Google Apps Script (GAS)**: データベース（ログ保存、マスタデータ提供）。
- **Google Sheets**:
    - `log`: 記録用シート
    - `master`: 家事メニュー管理
    - `config`: 労いメッセージ設定

## セットアップ手順

### 1. Google 側の準備
1. スプレッドシートを新規作成。
2. スクリプトエディタを開き、`Code.gs` を貼り付け。
3. デプロイ（Webアプリとして導入）。

詳細は [SETUP_MASTER.md](SETUP_MASTER.md) と [SETUP_CONFIG.md](SETUP_CONFIG.md) を参照してください。

### 2. Cloudflare Workers の準備
1. Cloudflare で Worker を作成。
2. `worker.js` を貼り付け。
3. 環境変数（Discord Token, ID, GAS URL）を設定。
4. 公開されたURLをDiscord Developer Portalの「Interactions Endpoint URL」に設定。

### 3. コマンド登録
`REGISTER_COMMAND.md` を参照して、Discordに `/panel` コマンドを登録してください。

## 運用
- `/panel` コマンドでパネルを表示。
- シートの値を書き換えたら、Discordの「🔄 更新」ボタンを押せば即座に反映されます。
