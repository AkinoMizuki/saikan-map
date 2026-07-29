(() => {
  'use strict';

  const SHARE_FORMAT = 'saikan-situation-share';
  const SHARE_VERSION = 1;
  const QR_PREFIX = 'SAIKAN1';
  const QR_CHUNK_SIZE = 680;
  const sessions = new Map();
  let currentShare = null;
  let currentPage = 0;

  const $ = (id) => document.getElementById(id);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function toast(message, type = 'info') {
    const region = $('toastRegion');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 6500);
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function sha256Hex(bytes) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  async function compress(bytes) {
    if (!('CompressionStream' in window)) return { codec: 'raw', bytes };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return { codec: 'gz', bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }

  async function decompress(bytes, codec) {
    if (codec === 'raw') return bytes;
    if (codec !== 'gz' || !('DecompressionStream' in window)) {
      throw new Error('このブラウザはGZIP共有データを展開できません。');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function randomId() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function splitEvery(value, length) {
    const result = [];
    for (let i = 0; i < value.length; i += length) result.push(value.slice(i, i + length));
    return result;
  }

  function cleanFeature(feature) {
    return {
      type: 'Feature',
      id: String(feature.id || feature.properties?.id || ''),
      geometry: feature.geometry,
      properties: {
        ...(feature.properties || {}),
        revision: Math.max(1, Number(feature.properties?.revision || 1))
      }
    };
  }

  async function createQrShare() {
    const api = window.SAIKAN_SHARE_API;
    if (!api) throw new Error('共有機能の初期化が完了していません。');
    if (typeof QRCode !== 'function') throw new Error('QR生成ライブラリを読み込めません。再読み込みしてください。');
    const context = api.getContext();
    if (!context.observations.length) throw new Error('共有する現地障害・報告がありません。');
    const payload = {
      format: SHARE_FORMAT,
      formatVersion: SHARE_VERSION,
      transferId: randomId(),
      createdAt: new Date().toISOString(),
      packId: context.packId,
      packName: context.packName,
      sourceVersion: context.appVersion,
      observations: context.observations.map(cleanFeature)
    };
    const packed = await compress(textEncoder.encode(JSON.stringify(payload)));
    const hash = (await sha256Hex(packed.bytes)).slice(0, 20);
    const body = bytesToBase64Url(packed.bytes);
    const pieces = splitEvery(body, QR_CHUNK_SIZE);
    const chunks = pieces.map((piece, index) => `${QR_PREFIX}|${payload.transferId}|${index + 1}|${pieces.length}|${packed.codec}|${hash}|${piece}`);
    currentShare = { payload, chunks, hash, codec: packed.codec };
    currentPage = 0;
    renderCurrentQr();
    const dialog = $('qrShareDialog');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function renderQr(target, text, size = 320) {
    target.replaceChildren();
    new QRCode(target, {
      text,
      width: size,
      height: size,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  function renderCurrentQr() {
    if (!currentShare) return;
    const chunk = currentShare.chunks[currentPage];
    renderQr($('qrCodeView'), chunk, 320);
    $('qrPageLabel').textContent = `${currentPage + 1} / ${currentShare.chunks.length}`;
    $('qrChunkText').value = chunk;
    $('qrPrevButton').disabled = currentPage <= 0;
    $('qrNextButton').disabled = currentPage >= currentShare.chunks.length - 1;
    $('qrShareSummary').textContent = `${currentShare.payload.packName} / 報告 ${currentShare.payload.observations.length}件 / QR ${currentShare.chunks.length}枚 / 作成 ${new Date(currentShare.payload.createdAt).toLocaleString('ja-JP')}`;
  }

  function parseChunk(text) {
    const value = String(text || '').trim();
    const match = value.match(/^SAIKAN1\|([0-9a-f]{16})\|(\d+)\|(\d+)\|(gz|raw)\|([0-9a-f]{20})\|([A-Za-z0-9_-]+)$/);
    if (!match) throw new Error('SAIKAN QR共有コードではありません。');
    const index = Number(match[2]);
    const total = Number(match[3]);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || index > total || total > 999) {
      throw new Error('QR分割番号が不正です。');
    }
    return { transferId: match[1], index, total, codec: match[4], hash: match[5], payload: match[6] };
  }

  function sessionStorageKey(id) {
    return `saikan-share-session:${id}`;
  }

  function loadSession(id) {
    if (sessions.has(id)) return sessions.get(id);
    try {
      const stored = JSON.parse(localStorage.getItem(sessionStorageKey(id)) || 'null');
      if (stored?.transferId === id) {
        sessions.set(id, stored);
        return stored;
      }
    } catch {}
    return null;
  }

  function saveSession(session) {
    sessions.set(session.transferId, session);
    localStorage.setItem(sessionStorageKey(session.transferId), JSON.stringify(session));
  }

  async function acceptChunkText(text) {
    const parsed = parseChunk(text);
    let session = loadSession(parsed.transferId);
    if (!session) {
      session = {
        transferId: parsed.transferId,
        total: parsed.total,
        codec: parsed.codec,
        hash: parsed.hash,
        chunks: {},
        updatedAt: new Date().toISOString()
      };
    }
    if (session.total !== parsed.total || session.codec !== parsed.codec || session.hash !== parsed.hash) {
      throw new Error('同じ共有IDで異なる分割情報が検出されました。');
    }
    session.chunks[String(parsed.index)] = parsed.payload;
    session.updatedAt = new Date().toISOString();
    saveSession(session);
    const received = Object.keys(session.chunks).length;
    $('qrImportStatus').textContent = `共有 ${parsed.transferId.slice(0, 8)}: ${received}/${session.total}枚を受信`;
    if (received === session.total) await completeSession(session);
  }

  async function completeSession(session) {
    const joined = Array.from({ length: session.total }, (_, i) => session.chunks[String(i + 1)]).join('');
    if (!joined) throw new Error('QR分割データが不足しています。');
    const packed = base64UrlToBytes(joined);
    const hash = (await sha256Hex(packed)).slice(0, 20);
    if (hash !== session.hash) throw new Error('QR共有データのSHA-256検証に失敗しました。');
    const unpacked = await decompress(packed, session.codec);
    const payload = JSON.parse(textDecoder.decode(unpacked));
    if (payload.format !== SHARE_FORMAT || payload.formatVersion !== SHARE_VERSION || !Array.isArray(payload.observations)) {
      throw new Error('SAIKAN共有パッケージ形式が不正です。');
    }
    const context = window.SAIKAN_SHARE_API.getContext();
    if (context.packId !== 'global' && payload.packId !== context.packId) {
      const proceed = confirm(`受信データは「${payload.packName || payload.packId}」用です。現在の地域「${context.packName}」とは異なります。元の地域IDへ保存しますか？`);
      if (!proceed) return;
    }
    const result = await window.SAIKAN_SHARE_API.mergeSituation(payload);
    localStorage.removeItem(sessionStorageKey(session.transferId));
    sessions.delete(session.transferId);
    $('qrImportStatus').textContent = `結合完了: 追加 ${result.added}件 / 更新 ${result.updated}件 / 重複・旧版 ${result.skipped}件 / 無効 ${result.invalid}件`;
    toast('QR共有データを検証・結合しました。', 'success');
  }

  async function importPastedChunks() {
    const values = $('qrPasteInput').value.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    if (!values.length) throw new Error('共有コードを貼り付けてください。');
    for (const value of values) await acceptChunkText(value);
    $('qrPasteInput').value = '';
  }

  async function decodeQrImages(files) {
    if (!files?.length) return;
    if (!('BarcodeDetector' in window)) {
      throw new Error('このブラウザはQR画像解析に対応していません。共有コード貼付を使用してください。');
    }
    const supported = await BarcodeDetector.getSupportedFormats?.();
    if (supported && !supported.includes('qr_code')) throw new Error('このブラウザはQRコード形式に対応していません。');
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    let detected = 0;
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      try {
        const results = await detector.detect(bitmap);
        for (const result of results) {
          if (result.rawValue) {
            await acceptChunkText(result.rawValue);
            detected += 1;
          }
        }
      } finally {
        bitmap.close?.();
      }
    }
    if (!detected) throw new Error('QRコードを画像から検出できませんでした。');
  }

  function modeName(mode) {
    return ({
      resident: '避難する（住民・支援者）',
      rescue: '救助・支援する（救助隊・支援者）',
      hq: '対策本部（全体状況管理）'
    })[mode] || mode;
  }

  function observationName(type) {
    return ({
      road_block: '道路閉塞', collapse: '建物崩落', flood: '浸水', landslide: '土砂崩れ',
      fire: '火災', bridge: '橋梁異常', rescue_needed: '要救助', safe: '安全確認', no_entry: '立入禁止'
    })[type] || type || '不明';
  }

  function buildSituationPrint() {
    const api = window.SAIKAN_SHARE_API;
    const context = api.getContext();
    $('printTitle').textContent = `災観 SAIKAN 状況図 — ${context.packName}`;
    $('printMeta').textContent = `印刷日時: ${new Date().toLocaleString('ja-JP')} / モード: ${modeName(context.mode)} / アプリ: ver ${context.appVersion}`;
    $('printDecision').textContent = context.decision;
    $('printFreshness').textContent = context.freshness;
    $('printSources').textContent = `ALOS-2: ${context.sourceStatuses.alos2} / QZSS: ${context.sourceStatuses.qzss} / 気象: ${context.sourceStatuses.weather}`;
    $('printRoute').textContent = context.route ? `表示ルート: ${context.route.name}` : '表示ルート: なし';
    const image = $('printMapImage');
    try {
      image.src = api.getMapCanvas().toDataURL('image/png');
      image.hidden = false;
      $('printMapFallback').hidden = true;
    } catch {
      image.hidden = true;
      $('printMapFallback').hidden = false;
      $('printMapFallback').textContent = '背景タイルの制約により地図画像を印刷へ埋め込めませんでした。画面のスクリーンショットを併用してください。';
    }
    const body = $('printObservationBody');
    body.replaceChildren();
    if (!context.observations.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = '現地障害・報告なし';
      row.appendChild(cell);
      body.appendChild(row);
    } else {
      context.observations.forEach((feature, index) => {
        const p = feature.properties || {};
        const row = document.createElement('tr');
        [index + 1, observationName(p.type), p.severity || '-', p.note || '-', new Date(p.updatedAt || p.createdAt || Date.now()).toLocaleString('ja-JP')].forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          row.appendChild(cell);
        });
        body.appendChild(row);
      });
    }
  }

  function printSituation() {
    buildSituationPrint();
    document.body.classList.add('printing-situation');
    requestAnimationFrame(() => window.print());
  }

  function printQrPages() {
    if (!currentShare) throw new Error('先にQR共有を作成してください。');
    const container = $('qrPrintPages');
    container.replaceChildren();
    currentShare.chunks.forEach((chunk, index) => {
      const page = document.createElement('section');
      page.className = 'qr-print-page';
      const title = document.createElement('h1');
      title.textContent = `災観 SAIKAN オフライン共有 ${index + 1}/${currentShare.chunks.length}`;
      const meta = document.createElement('p');
      meta.textContent = `${currentShare.payload.packName} / 報告 ${currentShare.payload.observations.length}件 / 共有ID ${currentShare.payload.transferId}`;
      const qr = document.createElement('div');
      qr.className = 'qr-print-code';
      const code = document.createElement('p');
      code.className = 'qr-print-code-text';
      code.textContent = chunk;
      page.append(title, meta, qr, code);
      container.appendChild(page);
      renderQr(qr, chunk, 420);
    });
    document.body.classList.add('printing-qr');
    requestAnimationFrame(() => window.print());
  }

  function bind() {
    $('createQrShareButton')?.addEventListener('click', () => createQrShare().catch((error) => toast(error.message, 'error')));
    $('qrPrevButton')?.addEventListener('click', () => {
      if (currentPage > 0) { currentPage -= 1; renderCurrentQr(); }
    });
    $('qrNextButton')?.addEventListener('click', () => {
      if (currentShare && currentPage < currentShare.chunks.length - 1) { currentPage += 1; renderCurrentQr(); }
    });
    $('qrCloseButton')?.addEventListener('click', () => $('qrShareDialog').close());
    $('copyQrChunkButton')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText($('qrChunkText').value);
      toast('現在の分割コードをコピーしました。', 'success');
    });
    $('printQrButton')?.addEventListener('click', () => {
      try { printQrPages(); } catch (error) { toast(error.message, 'error'); }
    });
    $('importQrTextButton')?.addEventListener('click', () => importPastedChunks().catch((error) => toast(error.message, 'error')));
    $('qrImageInput')?.addEventListener('change', async () => {
      const files = [...($('qrImageInput').files || [])];
      $('qrImageInput').value = '';
      try { await decodeQrImages(files); } catch (error) { toast(error.message, 'error'); }
    });
    $('selectQrImagesButton')?.addEventListener('click', () => $('qrImageInput').click());
    $('printSituationButton')?.addEventListener('click', printSituation);
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-situation', 'printing-qr');
    });
  }

  function init() {
    if (!window.SAIKAN_SHARE_API) {
      setTimeout(init, 100);
      return;
    }
    bind();
    $('qrImportStatus').textContent = 'QRは順不同で読み込めます。同じ共有IDの全枚が揃うと自動結合します。';
  }

  init();
})();
