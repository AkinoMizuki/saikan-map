# `.dmap` 地域パック形式 ver 1

## 概要

`.dmap` は、UTF-8 JSONコンテナをGZIP圧縮したファイルです。非圧縮版は `.dmap.json` とします。

MIME typeは配信環境により `application/gzip` または `application/octet-stream` で構いません。

## コンテナ

```json
{
  "format": "disaster-map-pack-container",
  "formatVersion": 1,
  "manifest": {},
  "files": {}
}
```

## manifest

必須項目：

```json
{
  "format": "disaster-map-pack",
  "formatVersion": 1,
  "id": "region-id-v1",
  "name": "地域名",
  "createdAt": "2026-07-29T00:00:00+09:00",
  "dataUpdatedAt": "2026-07-29T00:00:00+09:00",
  "center": [135.0, 35.0],
  "bounds": [134.9, 34.9, 135.1, 35.1],
  "attributions": [
    {"text": "データ提供者・ライセンス・加工表示"}
  ],
  "files": []
}
```

`id` は英数字、`.`, `_`, `-` のみ、最大120文字です。同じIDを導入した場合は上書き確認が表示されます。

## files定義

```json
{
  "path": "buildings.geojson",
  "role": "buildings",
  "mediaType": "application/geo+json",
  "bytes": 12345,
  "sha256": "..."
}
```

`bytes` と `sha256` はビルドツールが自動生成します。

パスには絶対パス、`..`、バックスラッシュを使用できません。

## payload

UTF-8テキスト：

```json
"buildings.geojson": {
  "encoding": "utf8",
  "data": "{...}"
}
```

バイナリ：

```json
"binary.dat": {
  "encoding": "base64",
  "data": "AAECAwQ="
}
```

## GeoJSON属性

### basemap

- `kind`: `water`, `park`, `road` 等
- `status`: `open`, `restricted`, `blocked`
- `width`: 道路描画幅

### buildings

- `id`
- `name`
- `height`: m
- `levels`
- `damage_score`: 0〜1
- `confirmed_status`: `unknown`, `safe`, `destroyed`
- `updated_at`

### hazards

- `id`
- `name`
- `hazard_type`: `change`, `flood`, `landslide`
- `confidence`: 0〜1
- `updated_at`

### routes

- `id`
- `name`
- `status`: `open`, `restricted`, `blocked`

### shelters

- `id`
- `name`
- `capacity`
- `status`

### weather

- `id`
- `name`
- `summary`
- `observed_at`

## 分割方針

大容量データは1ファイルにまとめず、次のいずれかで分割します。

- 市区町村単位
- 1次・2次メッシュ単位
- 災害対応区域単位
- 建物、地形、気象など用途別

端末が必要区域だけを取得できるよう、`data/catalog.json` に複数パックを登録します。
