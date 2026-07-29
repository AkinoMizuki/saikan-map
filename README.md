# 災害オフライン3Dマップ

GitHub Pagesへそのまま配置できる、無料・静的・オフライン優先の災害地図PWAです。

事前に地域パックを端末へ導入して「完全オフライン検証」を完了すれば、携帯基地局、インターネット、地図配信サーバーが利用できない状況でも、保存済みの地図・建物・危険領域・避難所・気象スナップショット・現地調査記録を表示できます。

> 現在の版は **MVP ver 0.1.0** です。ALOSのSAR解析、気象庁XML変換、PLATEAU/OSM変換そのものは外部処理として行い、生成したGeoJSONを地域パックへ格納する構成です。

## 実装済み

- ブラウザ標準機能だけで動く2D／疑似3D地図
- 建物ポリゴンの高さ押し出し表示
- 災害前後比較スライダー
- 危険領域、道路、避難所、保存済み気象情報の重畳
- 建物ID・名称検索
- GNSS現在地取得
- 現地調査記録の端末内保存
- 調査記録のGeoJSON入出力
- GZIP圧縮地域パック（`.dmap`）
- 地域パック内ファイルのSHA-256検証
- Service Workerによるアプリ本体のオフライン保存
- IndexedDBによる地域パック・調査記録保存
- 永続ストレージ要求と使用容量表示
- 完全オフライン検証
- 選択中地域パック削除
- 全地域パック削除
- 全調査記録削除
- アプリキャッシュ消去
- `RESET`入力による完全初期化
- 画面下部へのクレジット常時表示
- GitHub ActionsによるGitHub Pages自動配備
- 外部APIキー、従量課金、広告、アクセス解析なし

## GitHubへ置く方法

1. このフォルダーの中身を、公開GitHubリポジトリのルートへ配置します。
2. `main` ブランチへpushします。
3. GitHubの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にします。
4. `Deploy GitHub Pages` ワークフローが完了すると公開されます。

リポジトリ名が `disaster-offline-map` の場合、通常は次の形式です。

```text
https://<GitHubユーザー名>.github.io/disaster-offline-map/
```

相対パス、PWAの `scope`、Service Workerのキャッシュパスは、プロジェクトページ配下でも動くように構成済みです。

## 初回利用手順

1. オンライン状態でサイトを開く。
2. 「訓練パックを導入」を押して動作確認する。
3. 必要な実地域の `.dmap` を「端末から読込」またはURLから導入する。
4. 「永続保存を要求」を押す。
5. 「完全オフライン検証」を押す。
6. 機内モードまたは通信を切った状態で、ページ再起動・地図表示・記録保存を実地確認する。
7. `.dmap` 原本を端末のダウンロードフォルダー、SDカード、USBメモリ等にも保持する。

ブラウザの保存領域は、利用者によるサイトデータ削除や端末管理ポリシーの影響を受けます。災害用途では、PWA内部保存だけに依存せず `.dmap` 原本を別媒体にも保持してください。

## キャッシュ・データ削除

操作パネルの「キャッシュ・データ削除」から実行できます。

| 操作 | アプリ本体キャッシュ | 地域パック | 調査記録 | 設定 |
|---|---:|---:|---:|---:|
| アプリキャッシュを消去 | 削除 | 保持 | 保持 | 保持 |
| 選択中パックを削除 | 保持 | 選択中のみ削除 | 選択中に関連する記録も削除 | 一部更新 |
| 全地域パックを削除 | 保持 | 全削除 | 保持 | 選択解除 |
| 全調査記録を削除 | 保持 | 保持 | 全削除 | 保持 |
| アプリを完全初期化 | 削除 | 全削除 | 全削除 | 全削除 |

完全初期化では誤操作防止のため `RESET` の入力が必要です。他のGitHub Pagesアプリに影響しないよう、このアプリ固有のCache Storage、IndexedDB、Service Workerだけを削除します。

## 地域パックの作成

サンプルソースは `data/source/training-sample/` にあります。

```bash
python3 tools/build_region_pack.py \
  data/source/training-sample \
  data/packs/training-sample.dmap \
  --write-json
```

検証：

```bash
python3 tools/validate_region_pack.py data/packs/training-sample.dmap
```

`manifest.template.json` の `files` に、役割とファイルを登録します。

| role | 内容 | 対応GeoJSON |
|---|---|---|
| `basemap` | 道路、水域、公園など | Polygon / MultiPolygon / LineString / MultiLineString |
| `buildings` | 災害前建物 | Polygon / MultiPolygon |
| `hazards` | SAR変化、浸水、土砂等 | Polygon / MultiPolygon |
| `routes` | 進入路、通行止め | LineString / MultiLineString |
| `shelters` | 避難所、活動拠点 | Point |
| `weather` | 保存済み観測・警報地点 | Point |

詳細は [`docs/PACK_FORMAT.md`](docs/PACK_FORMAT.md) を参照してください。

## 実データ処理の推奨パイプライン

```text
ALOS / ALOS-2 / 航空写真 / ドローン
    ↓ 外部PC・研究環境で位置補正と変化解析
危険領域GeoJSON

PLATEAU / OpenStreetMap / 基盤地図情報
    ↓ 外部PCで切出し・属性整理
建物・道路・避難所GeoJSON

気象庁防災情報XML / 観測データ
    ↓ 外部PCまたはGitHub Actionsでスナップショット化
気象GeoJSON

各GeoJSON
    ↓ tools/build_region_pack.py
地域パック .dmap
    ↓ 端末へ事前導入
完全オフライン利用
```

このアプリは解析結果を表示するクライアントです。SAR差分だけで「倒壊確定」とせず、`damage_score` は「変化疑い」として扱い、`confirmed_status` は現地確認や公的情報で更新してください。

## 建物属性

主に次の属性を使用します。

```json
{
  "id": "building-001",
  "name": "建物名",
  "height": 18,
  "levels": 6,
  "damage_score": 0.72,
  "confirmed_status": "unknown",
  "updated_at": "2026-07-29T00:00:00+09:00"
}
```

`damage_score` は0〜1を想定します。

- `0`: 変化なしまたは未検出
- `1`: 強い変化疑い

`confirmed_status` の例：

- `unknown`
- `safe`
- `destroyed`

## クレジット

各地域パックの `manifest.attributions` を画面下部へ常時表示します。実データを使う場合は、配布元ごとの利用規約に従い、最低でも次を地域パックへ含めてください。

- データ提供者名
- データセット名
- ライセンスまたは利用規約
- 加工・解析を行った旨
- データ取得日または更新日

例：

```json
"attributions": [
  {"text": "地図・標高：国土地理院（本サイトで加工）"},
  {"text": "3D都市モデル：Project PLATEAU／データ提供自治体"},
  {"text": "建物補完：© OpenStreetMap contributors, ODbL"},
  {"text": "衛星データ：JAXA ALOS（本サイトで解析）"},
  {"text": "気象・防災情報：気象庁（本サイトで変換）"}
]
```

データセットごとに条件が異なるため、公開前に必ず原典の最新条件を確認してください。

## 制約

- ブラウザ内でALOS生データの重いSAR解析は行いません。
- GitHub Pagesは静的配信なので、複数端末のリアルタイム同期や認証付き投稿は行いません。
- 通信断後は、気象・道路・衛星解析・他端末記録は更新されません。
- `.dmap` はMVPではJSONコンテナをGZIP圧縮した形式です。数百MB級は自治体・メッシュ単位に分割してください。
- 疑似3D描画はWebGL地図エンジンではなくCanvas 2Dです。低性能端末での確実なオフライン動作を優先しています。
- 現在地取得は端末・OS・ブラウザの測位機能と権限に依存します。

## ローカル確認

Service Workerは `file://` では動作しません。HTTPサーバーを使用してください。

```bash
python3 -m http.server 8000
```

```text
http://localhost:8000/
```

## ライセンス

アプリケーションコードはMIT Licenseです。地域パックに含める各データのライセンスは、データ提供者の条件に従います。
