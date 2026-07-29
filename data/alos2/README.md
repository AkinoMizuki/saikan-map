# ALOS-2 / PALSAR-2 Webレイヤー

SAIKANは、JAXAが公開するALOS-2/PALSAR-2の原データをブラウザ内で直接解析しません。

L2.1 GeoTIFFなどを外部PCで位置確認・輝度調整・切り出しし、PNGまたはWebPへ変換して `catalog.json` に登録します。利用者はSAIKAN画面の「ALOS-2データを取得」ボタンから画像をダウンロードし、IndexedDBへ保存して地図へ重畳できます。

## catalog.json の例

```json
{
  "id": "alos2-example-20260729",
  "name": "ALOS-2 変化抽出結果",
  "observedAt": "2026-07-29T00:00:00+09:00",
  "bounds": [130.70, 32.70, 130.85, 32.82],
  "imageUrl": "./data/alos2/layers/example.webp",
  "opacity": 0.65,
  "sha256": "...",
  "attribution": "ALOS-2/PALSAR-2: JAXA EORC（SAIKANで表示用加工）",
  "sourceUrl": "https://www.eorc.jaxa.jp/ALOS/"
}
```

## 注意

- JAXAのデータセットごとの利用条件を確認してください。
- 公開災害データは非商用目的に限定される場合があります。
- 解析画像だけで倒壊や被害を確定しないでください。
- 元のGeoTIFF、変換条件、観測日時、軌道、偏波、処理履歴を別途記録してください。
- GitHub Pagesへ数GBの原データを置かず、地域単位で軽量化してください。
