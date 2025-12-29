# toyutoyu-suporter

と湯と湯という温泉ポータルサイトが疎通しているかを通知するLine Bot。

`https://toyutoyu.com/app/` と `https://toyutoyu.com/` を15分ごとに疎通確認し、失敗時に通知します。

## 動作

- Cron: 15分ごと（既定: `*/15 * * * *`、タイムゾーン既定: `Asia/Tokyo`）
- 監視: HTTP 2xx と 404 を成功扱い、その他は失敗扱い
- 通知: 常にログ出力。加えてLINE Push通知は環境変数が揃っている場合のみ実施

## 環境変数

- `TARGET_URLS`（任意）: カンマ区切りURL（未指定時は2URLを監視）
- `CRON_SCHEDULE`（任意）: 既定 `*/15 * * * *`
- `CRON_TIMEZONE`（任意）: 既定 `Asia/Tokyo`
- `TIMEOUT_MS`（任意）: 既定 `10000`

LINE（任意）

- `LINE_CHANNEL_ACCESS_TOKEN`: Messaging APIのチャネルアクセストークン（Pushに必要）
- `LINE_TO`: 送信先（userId / groupId / roomId）
- `LINE_BROADCAST`: `1` の場合は全員に配信（LINE側のBroadcast権限/制限に依存）
- `LINE_CHANNEL_SECRET`: Webhook署名検証用（Webhookを使う場合のみ）

認証/ポイント連携（任意。LINEで「ログイン」「ポイント」を使う場合）

- `TOYUTOYU_WP_BASE_URL`: 既定 `https://toyutoyu.com/app`
- `TOYUTOYU_WP_WEBHOOK_SECRET`: （任意）`POST /wp-json/toyutoyu/v1/auth-check` の `X-Toyutoyu-Webhook-Secret`（WP側設定により不要な場合あり）
- `LOGIN_FLOW_TTL_MS`: ログイン途中状態のTTL（既定 10分）
- `LOGGED_IN_TTL_MS`: ログイン済み状態のTTL（既定 60分）

※ご提示の「Channel」/「Channel secret」のうち、通知（Push）に必須なのは `LINE_CHANNEL_ACCESS_TOKEN` です。

## ローカル実行

```bash
npm install
npm start
```

## Fly.io デプロイ

1. `fly.toml` の `app` 名をユニークな名前に変更

1. シークレットを設定（LINE通知する場合）

```bash
fly secrets set LINE_CHANNEL_ACCESS_TOKEN=...
```

※全員配信（Broadcast）では `LINE_TO` は不要です。特定宛先にPushする場合のみ `LINE_TO` を設定してください。

1. デプロイ

```bash
fly deploy
```

Webhookは任意です。必要なら `POST /callback` をLINE Developersで設定してください。

## LINEでの使い方

Webhook（`/callback`）にメッセージが届いた場合、以下の簡易フローで応答します。

- 「ログイン」→ メールアドレス → パスワード（`auth-check` による検証）
- ログイン後に「ポイント」→ `user-points` をメールアドレスで取得して返信

※ログイン状態はサーバーのメモリ上に保持します（プロセス再起動で消えます）。

