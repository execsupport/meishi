# Meishi — 名刺管理 Web アプリ SPEC (2026-10-23)

## 狙い
名刺を「開いた瞬間メモ -> フリックで整理」できる、Cloudflare 完結・Google 認証のモバイル Web アプリ。
管理者(Chie)が 1 人で何百枚も扱える前提: スキャン(単枚/複数)・検索・重複検知・CSV/vCard 書き出し。

## 技術選定と理由
| 層 | 選定 | 理由 |
|---|---|---|
| ホスティング/API | Cloudflare Workers + Static Assets (1 Worker) | SPA と API を 1 デプロイでエッジ配信。コールドスタート無し。静的配信は無料。 |
| ルーティング | Hono | 14KB、Workers ネイティブ、型付き Context。 |
| DB | Cloudflare D1 (SQLite) | users / sessions / cards のリレーショナルデータ。Worker からネイティブ binding。`UPDATE ... RETURNING` で競合安全。 |
| 画像保存 | Workers KV (binary value, 25MB 上限) | このアカウントは R2 が未有効(ダッシュボード操作が必要)なので KV で代替。名刺画像は端末側で 1280px/JPEG q0.8 に縮小(約 150-300KB)してから保存。将来 R2 を有効化したら `ImageStore` インターフェースの実装を差し替えるだけ。 |
| AI | Workers AI: 視覚 `@cf/meta/llama-3.2-11b-vision-instruct`(名刺 OCR -> JSON) / テキスト `@cf/meta/llama-3.3-70b-instruct-fp8-fast`(メモ -> 氏名/会社/役職 抽出、JSON schema 出力) | Worker と同じネットワークで動き外部 API キー不要。日本語対応。モデル呼び出し失敗時はルールベース fallback で UI が行き止まりにならない。実装前に `wrangler ai models` でモデル ID の存在を確認する。 |
| 認証 | Google OAuth 2.0 Authorization Code + PKCE を自前実装 | ライブラリ・外部 IdP 不要。セッションは D1 にトークンの SHA-256 のみ保存。Cookie は HttpOnly/Secure/SameSite=Lax。全書込に Origin チェック(CSRF)。Google 以外のログイン手段は無し。 |
| UI | Preact + TypeScript + Vite | React 流コンポーネントを 4KB で。初回表示をモバイルで速くするため。 |
| モーション | Web Animations API + CSS `linear()` スプリング曲線 | 本物のバネ物理をライブラリ 0KB で。`prefers-reduced-motion` 尊重。 |
| スタイル | 素の CSS (backdrop-filter / mask / color-mix) | Liquid Glass(多層ブラー・スペキュラ・屈折リム)はフレームワーク無しで最も素直に書ける。白ベース。 |
| オフライン/瞬間起動 | Service Worker (app shell) + localStorage outbox | 再訪は即表示。未ログイン/オフラインで書いたメモは失われず、ログイン時にアカウントへ移送。 |
| テスト | Playwright (mobile Chromium 390 touch / mobile WebKit iPhone / desktop Chromium 1280) | 要件「実ブラウザ操作で全合格」をそのまま自動化。 |

## 画面と挙動
1. **開いた瞬間メモ**: 初回ペイント時点でメモ欄が focus 済み・入力可能(バンドル読込前の静的 HTML でも動く)。Enter/保存で「名刺(status=inbox)」が 1 枚できる。メモだけの名刺(画像なし)を許容。
2. **スケルトン**: バンドル読込〜データ取得中は全画面スケルトン(名刺カード形のプレースホルダ・シマー)。
3. **フリック**: 右フリック = 進む(inbox -> follow -> done)、左フリック = 戻る。inbox で左 = アーカイブ(Undo トースト 5 秒)。done で右 = アーカイブ(Undo)。閾値・速度判定・スプリングで元位置へ戻る。
4. **ステータス**: inbox(未整理) / follow(フォロー中) / done(完了) / archived(アーカイブ)。タブで切替、件数バッジ。
5. **スキャン**: `<input type=file accept=image/* capture=environment multiple>`。複数選択可。端末側で縮小 -> `/api/cards/scan` -> Workers AI 視覚モデルで {name, name_kana, company, title, department, email, phone, mobile, address, website, memo_hint} を JSON 抽出 -> 確認シート(編集可)-> 保存。複数枚はキューで順次処理し進捗表示。AI 失敗時は画像だけ保存して手入力へ。
6. **重複検知**: 保存前に email / 電話(数字正規化) / 氏名+会社 の一致で既存カードを提示し「統合 / 別として保存」を選べる。
7. **一覧と検索**: 氏名・会社・メモの部分一致を即時検索(ローカル、D1 への問合せ無し)。カード詳細は Sheet で開き、タップで編集、画像拡大。
8. **書き出し**: CSV(UTF-8 BOM、Excel で開ける)全件 / vCard(.vcf) 1 枚単位(iPhone 連絡先に追加できる)。
9. **AI メモ解析**: メモ本文から氏名・会社・役職を抜いて空欄を埋める(ボタン 1 つ)。
10. **キャッチコピー・説明文は一切出さない**。ラベルは機能名のみ。絵文字は使わない。アイコンは SVG。
11. **アクセシビリティ**: フリック操作には同等のボタン(進む/戻る/アーカイブ)を長押しメニューで提供。

## デザイン
- Liquid Glass、白ベース(#ffffff / #f6f7f9)。ガラス面は半透明白 + backdrop-filter blur(20-28px) + 1px 内側ハイライト + 薄い屈折リム。
- 角丸 14-20px、ピルは 999px。サンセリフ(system-ui, -apple-system, "Hiragino Sans")。字間 0。
- アクセントはダスティブルー系 1 色(例 #6B8BB5)、状態ピルはくすみ色(セージ/ゴールド/ローズ)。ダスティピンクを基調にしない。
- アニメーション: カード出現(stagger)、タブ切替(下線スプリング)、シート(bottom sheet スプリング)、フリック(追従 + リリース後スプリング)、スケルトン(シマー)、トースト、ボタン押下(scale 0.97)。
- PC 1280 / 携帯 390 の両方で崩れないこと。微妙な改行禁止(word-break:auto-phrase, text-wrap:balance)。

## API
- `GET /auth/google` -> Google / `GET /auth/google/callback` / `POST /auth/logout` / `GET /api/me`
- `GET /api/cards` / `POST /api/cards` / `PATCH /api/cards/:id` / `DELETE /api/cards/:id`(アーカイブ) / `POST /api/cards/:id/restore`
- `POST /api/cards/scan`(multipart image -> AI 抽出 + 画像 KV 保存、カードはまだ作らない) / `GET /api/images/:key`(本人のみ)
- `POST /api/ai/parse-memo`
- `GET /api/export.csv` / `GET /api/cards/:id.vcf`
- `POST /api/cards/import`(未ログイン時の localStorage outbox を一括移送)
- `DEV_LOGIN=1` かつ localhost のときだけ `/auth/dev`(テスト専用)。本番には絶対に設定しない。

## リポジトリ / 公開
- GitHub `execsupport/meishi` public。README に技術選定表・ローカル手順・デプロイ手順・Google OAuth クライアント作成手順。
- Cloudflare: D1 `meishi`、KV `MEISHI_IMAGES`、Worker `meishi`。`npm run deploy`。
- 秘密情報(.dev.vars)はコミットしない。

## 完了条件
- `npm test` が 3 ブラウザ全部で緑。
- 本番 URL で未ログインの一般人がログイン画面に到達でき、スケルトン -> メモ欄 focus まで通る(Incognito 確認)。
- Google 認証の本番確認には Google Cloud Console の OAuth クライアント(Chie 作成)が必要。未提供の間は「未確認: 本番 Google ログイン」と明記する。
