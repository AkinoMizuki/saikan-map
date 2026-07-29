from pathlib import Path

path = Path('index.html')
source = path.read_text(encoding='utf-8')

source = source.replace('ver 0.3.0', 'ver 0.3.1')
source = source.replace(
    '  <link rel="stylesheet" href="./saikan-v3.css">\n  <script defer src="./app-v3.js?v=0.3.0"></script>',
    '  <link rel="stylesheet" href="./saikan-v3.css">\n  <link rel="stylesheet" href="./share-v31.css">\n  <script defer src="./vendor/qrcode.min.js"></script>\n  <script defer src="./app-v3.js?v=0.3.1"></script>\n  <script defer src="./share-v31.js?v=0.3.1"></script>'
)

old_mode = '''  <div class="modebar" aria-label="利用モード">
    <button type="button" class="mode-button active" data-mode="resident">避難する</button>
    <button type="button" class="mode-button" data-mode="rescue">救助・支援する</button>
    <button type="button" class="mode-button" data-mode="hq">対策本部</button>
  </div>'''
new_mode = '''  <div class="modebar" aria-label="利用者と目的を切り替える">
    <button type="button" class="mode-button active" data-mode="resident" title="地域住民・避難支援者向け">
      <strong>避難する</strong><small>住民・避難支援者</small>
    </button>
    <button type="button" class="mode-button" data-mode="rescue" title="消防・警察・自衛隊・DMAT・支援者向け">
      <strong>救助・支援する</strong><small>救助隊・現地支援者</small>
    </button>
    <button type="button" class="mode-button" data-mode="hq" title="災害対策本部・指揮所向け">
      <strong>対策本部</strong><small>全体状況・部隊管理</small>
    </button>
  </div>'''
if old_mode not in source:
    raise SystemExit('modebar target not found')
source = source.replace(old_mode, new_mode, 1)

share_section = '''
      <section class="panel-section">
        <h2>オフライン共有・印刷</h2>
        <p class="help">現地障害・要救助・安全確認の報告を、複数QRへ分割して通信なしで受け渡せます。受信側は順不同で読み込み、ID・revision・更新日時で重複排除して結合します。</p>
        <div class="button-grid two-columns">
          <button id="createQrShareButton" type="button">QR共有を作成</button>
          <button id="selectQrImagesButton" type="button">QR画像を読込</button>
        </div>
        <input id="qrImageInput" type="file" accept="image/*" multiple hidden>
        <label for="qrPasteInput">共有コードを貼り付け</label>
        <textarea id="qrPasteInput" rows="3" spellcheck="false" placeholder="QR読取アプリから取得したSAIKAN1|...を貼り付け。複数コードは改行で入力できます。"></textarea>
        <button id="importQrTextButton" type="button">貼付コードを検証・結合</button>
        <div id="qrImportStatus" class="info-box" aria-live="polite">QR共有機能を準備中です。</div>
        <button id="printSituationButton" type="button">現在の状況図・報告一覧を印刷</button>
      </section>
'''
share_needle = '''        <div id="observationList" class="report-list"></div>
      </section>

      <section class="panel-section">
        <h2>表示レイヤー</h2>'''
if share_needle not in source:
    raise SystemExit('sharing section target not found')
source = source.replace(
    share_needle,
    '''        <div id="observationList" class="report-list"></div>
      </section>
''' + share_section + '''
      <section class="panel-section">
        <h2>表示レイヤー</h2>''',
    1
)

legend = '''
      <div class="map-legend" aria-label="地図記号の説明">
        <strong>地図記号</strong>
        <span><i class="legend-dot legend-start"></i>出発点</span>
        <span><i class="legend-dot legend-shelter"></i>避難候補</span>
        <span><i class="legend-dot legend-destination"></i>救助目的地</span>
        <span><i class="legend-line legend-route"></i>推奨ルート</span>
        <span><i class="legend-area legend-obstacle"></i>現地障害・危険</span>
      </div>
'''
canvas_needle = '      <canvas id="mapCanvas" tabindex="0" aria-label="左ドラッグで移動、右ドラッグまたはShiftとドラッグで回転。記録モードではクリックして地点・線・エリアを入力します。"></canvas>\n'
if canvas_needle not in source:
    raise SystemExit('map canvas target not found')
source = source.replace(canvas_needle, canvas_needle + legend, 1)

extras = '''

  <dialog id="qrShareDialog" class="qr-share-dialog">
    <div class="qr-dialog-header">
      <div>
        <h2>QR分割オフライン共有</h2>
        <p id="qrShareSummary"></p>
      </div>
      <button id="qrCloseButton" type="button" class="danger-outline">閉じる</button>
    </div>
    <div id="qrCodeView" class="qr-code-view" aria-label="共有QRコード"></div>
    <div class="qr-page-controls">
      <button id="qrPrevButton" type="button">前のQR</button>
      <strong id="qrPageLabel">1 / 1</strong>
      <button id="qrNextButton" type="button">次のQR</button>
    </div>
    <label for="qrChunkText">現在の分割コード</label>
    <textarea id="qrChunkText" rows="3" readonly spellcheck="false"></textarea>
    <div class="button-grid two-columns">
      <button id="copyQrChunkButton" type="button">現在コードをコピー</button>
      <button id="printQrButton" type="button">QR全枚を印刷</button>
    </div>
    <p class="help">全ページを同じ共有IDとして読み込むと自動結合します。QRは順不同で構いません。</p>
  </dialog>

  <section id="printSheet" class="print-sheet" aria-hidden="true">
    <header>
      <h1 id="printTitle">災観 SAIKAN 状況図</h1>
      <p id="printMeta"></p>
    </header>
    <section class="print-summary">
      <h2>現在の判断</h2>
      <p id="printDecision"></p>
      <p id="printFreshness"></p>
      <p id="printSources"></p>
      <p id="printRoute"></p>
    </section>
    <img id="printMapImage" alt="現在の状況地図">
    <p id="printMapFallback" hidden></p>
    <section>
      <h2>現地障害・報告一覧</h2>
      <table>
        <thead><tr><th>No.</th><th>種別</th><th>重要度</th><th>内容</th><th>更新日時</th></tr></thead>
        <tbody id="printObservationBody"></tbody>
      </table>
    </section>
    <footer>自動判定は安全を保証しません。公的指示・現地判断を優先してください。地図・道路 © OpenStreetMap contributors。</footer>
  </section>

  <div id="qrPrintPages" class="qr-print-pages" aria-hidden="true"></div>
'''
body_needle = '  <div id="toastRegion" class="toast-region" aria-live="polite" aria-atomic="true"></div>\n</body>'
if body_needle not in source:
    raise SystemExit('body insertion target not found')
source = source.replace(body_needle, '  <div id="toastRegion" class="toast-region" aria-live="polite" aria-atomic="true"></div>' + extras + '\n</body>', 1)

path.write_text(source, encoding='utf-8')
