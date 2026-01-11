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

## Webダッシュボード (Fire HD 8 対応)
FireタブレットやPCブラウザで常時表示できるダッシュボード機能です。
- **Fire HD 8 最適化**: 1280x800px にフィットする専用レイアウト。
- **モダンUI & 動的テーマ**:
    - ユーザー1 (夫): クールなブルー基調
    - ユーザー2 (妻): 温かみのあるオレンジ基調
    - ユーザーを切り替えるとテーマカラーも瞬時に変化します。
- **ドリルダウン操作**: 「カテゴリ」→「タスク」の順で直感的に記録可能。

## 構成
- **Discord**: ユーザーインターフェース（チャット、コマンド）。
- **Cloudflare Workers**: Discordとの通信、署名検証、Gateway。
- **Google Apps Script (GAS)**:
    - バックエンド: データベース操作、ポイント集計。
    - フロントエンド: Webダッシュボード画面の配信 (`doGet`)。
- **Google Sheets**:
    - `log`: 記録用シート
    - `master`: 家事メニュー管理
    - `config`: 労いメッセージ設定

## セットアップ手順

### 1. Google 側の準備
1. スプレッドシートを新規作成。
2. スクリプトエディタを開き、[`gas/Code.gs`](gas/Code.gs) と [`gas/index.html`](gas/index.html) を追加。
3. **スクリプトプロパティを設定**:
    - `DISCORD_WEBHOOK_URL`: 通知用Discord Webhook URL
    - `USER_MAPPING_JSON`: `{"DiscordUserA": "夫", "DiscordUserB": "妻"}` (Discord名と表示名のマッピング)
4. デプロイ（Webアプリとして導入）。
    - *アクセス権限: 全員 (Anyone)*

詳細は [SETUP_MASTER.md](docs/SETUP_MASTER.md) と [SETUP_CONFIG.md](docs/SETUP_CONFIG.md) を参照してください。

### 2. Cloudflare Workers の準備
1. Cloudflare で Worker を作成。
2. [`worker/worker.js`](worker/worker.js) を貼り付け。
3. 環境変数 (`DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `GAS_WEBHOOK_URL`) を設定。
   - `GAS_WEBHOOK_URL` には GASのWeb App URLを設定します。
4. 公開されたURLをDiscord Developer Portalの「Interactions Endpoint URL」に設定。

### 3. コマンド登録
[`docs/REGISTER_COMMAND.md`](docs/REGISTER_COMMAND.md) を参照して、Discordに `/panel` コマンドを登録してください。

## 運用
- **Discord**: `/panel` コマンドでパネルを表示。
- **Webダッシュボード**: GASのWeb App URLをブラウザ（Fireタブレットなど）で開く。
    - 全画面表示ボタンでキオスクモードのように利用可能。
- **マスタ更新**: シートの値を書き換えたら、Discordの「🔄 更新」ボタンを押すか、Dashboardが自動更新（1分毎）されるのを待ちます。
