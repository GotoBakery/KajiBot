# コマンド登録手順 (Cloudflare Workers経由)

GASからのコマンド登録がブロックされるため、Cloudflare Workers経由で登録を行います。

## 1. Cloudflare Workers の環境変数を追加
Cloudflare Dashboard > Workers > Settings > Variables に移動し、以下の2つを追加してください。

- **`DISCORD_BOT_TOKEN`**: Discord Developer PortalからコピーしたBot Token
- **`APPLICATION_ID`**: DiscordのApplication ID

※追加後、必ず **Save and Deploy** をクリックしてください。

## 2. Workerコードの更新
1. パソコン上の `worker.js` の内容（最新版）をコピーします。
2. Cloudflare Dashboardでコードを編集し、すべて上書きして保存・デプロイしてください。

## 3. コマンド登録の実行
1. ブラウザを開き、以下のURLにアクセスしてください。
   `https://<あなたのWorkerのURL>/register`
   （例: `https://kajibot.username.workers.dev/register`）

2. 画面に **"Success! Commands registered."** と表示されれば完了です。

## 4. Discordで確認
Discordに戻り `/panel` と入力してみてください。コマンドが表示されるはずです。
