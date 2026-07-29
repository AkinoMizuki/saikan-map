(() => {
  'use strict';

  const APP_VERSION = '0.1.0';
  const DB_NAME = 'disaster-offline-map-v1';
  const DB_VERSION = 1;
  const CACHE_PREFIX = 'domap-shell-';
  const OFFLINE_ASSET_PATHS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './manifest.webmanifest',
    './assets/icon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './data/catalog.json'
  ];

  const $ = (id) => document.getElementById(id);
  const dom = {
    networkBadge: $('networkBadge'),
    packBadge: $('packBadge'),
    versionBadge: $('versionBadge'),
    staleBanner: $('staleBanner'),
    staleText: $('staleText'),
    sidebar: $('sidebar'),
    sidebarToggle: $('sidebarToggle'),
    workspace: document.querySelector('.workspace'),
    packSelect: $('packSelect'),
    installSampleButton: $('installSampleButton'),
    importPackButton: $('importPackButton'),
    packFileInput: $('packFileInput'),
    packUrlInput: $('packUrlInput'),
    installUrlButton: $('installUrlButton'),
    packDetails: $('packDetails'),
    deleteActivePackButton: $('deleteActivePackButton'),
    compareSlider: $('compareSlider'),
    compareValue: $('compareValue'),
    searchInput: $('searchInput'),
    searchButton: $('searchButton'),
    searchResults: $('searchResults'),
    reportCategory: $('reportCategory'),
    reportStatus: $('reportStatus'),
    reportNote: $('reportNote'),
    useCurrentLocation: $('useCurrentLocation'),
    addReportButton: $('addReportButton'),
    exportReportsButton: $('exportReportsButton'),
    importReportsButton: $('importReportsButton'),
    reportFileInput: $('reportFileInput'),
    reportList: $('reportList'),
    storageSummary: $('storageSummary'),
    requestPersistButton: $('requestPersistButton'),
    prepareOfflineButton: $('prepareOfflineButton'),
    offlineCheckResults: $('offlineCheckResults'),
    clearCacheButton: $('clearCacheButton'),
    deleteReportsButton: $('deleteReportsButton'),
    deleteAllPacksButton: $('deleteAllPacksButton'),
    fullResetButton: $('fullResetButton'),
    mapCanvas: $('mapCanvas'),
    emptyMapMessage: $('emptyMapMessage'),
    zoomInButton: $('zoomInButton'),
    zoomOutButton: $('zoomOutButton'),
    toggle3dButton: $('toggle3dButton'),
    locateButton: $('locateButton'),
    homeViewButton: $('homeViewButton'),
    mapScale: $('mapScale'),
    mapPopup: $('mapPopup'),
    attributionText: $('attributionText'),
    progressDialog: $('progressDialog'),
    progressTitle: $('progressTitle'),
    progressMessage: $('progressMessage'),
    progressBar: $('progressBar'),
    toastRegion: $('toastRegion')
  };

  let db = null;
  let catalog = [];
  let activePack = null;
  let activeData = emptyDataset();
  let reports = [];
  let currentLocation = null;
  let persistViewTimer = null;

  function emptyDataset() {
    return {
      basemap: featureCollection(),
      buildings: featureCollection(),
      hazards: featureCollection(),
      routes: featureCollection(),
      shelters: featureCollection(),
      weather: featureCollection()
    };
  }

  function featureCollection(features = []) {
    return { type: 'FeatureCollection', features };
  }

  function toast(message, type = 'info', timeout = 4200) {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    dom.toastRegion.appendChild(item);
    window.setTimeout(() => item.remove(), timeout);
  }

  function showProgress(title, message, value = null) {
    dom.progressTitle.textContent = title;
    dom.progressMessage.textContent = message;
    if (value === null) {
      dom.progressBar.removeAttribute('value');
    } else {
      dom.progressBar.value = value;
    }
    if (!dom.progressDialog.open) dom.progressDialog.showModal();
  }

  function updateProgress(message, value = null) {
    dom.progressMessage.textContent = message;
    if (value === null) dom.progressBar.removeAttribute('value');
    else dom.progressBar.value = value;
  }

  function hideProgress() {
    if (dom.progressDialog.open) dom.progressDialog.close();
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatDate(value) {
    if (!value) return '不明';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ja-JP');
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('packs')) {
          database.createObjectStore('packs', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('files')) {
          const store = database.createObjectStore('files', { keyPath: 'key' });
          store.createIndex('packId', 'packId', { unique: false });
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains('reports')) {
          const store = database.createObjectStore('reports', { keyPath: 'id' });
          store.createIndex('packId', 'packId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('別タブがデータベースを使用中です。別タブを閉じて再試行してください。'));
    });
  }

  async function dbGet(storeName, key) {
    const tx = db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).get(key));
  }

  async function dbPut(storeName, value) {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    await transactionDone(tx);
  }

  async function dbDelete(storeName, key) {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    await transactionDone(tx);
  }

  async function dbGetAll(storeName) {
    const tx = db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).getAll());
  }

  async function dbGetAllByIndex(storeName, indexName, key) {
    const tx = db.transaction(storeName, 'readonly');
    const index = tx.objectStore(storeName).index(indexName);
    return requestToPromise(index.getAll(IDBKeyRange.only(key)));
  }

  async function deleteByIndex(store, indexName, key) {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName);
      const request = index.openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB cursor failed'));
    });
  }

  async function getSetting(key, fallback = null) {
    const record = await dbGet('settings', key);
    return record ? record.value : fallback;
  }

  async function setSetting(key, value) {
    await dbPut('settings', { key, value });
  }

  async function deletePackData(packId, deleteRelatedReports = false) {
    const stores = deleteRelatedReports ? ['packs', 'files', 'reports'] : ['packs', 'files'];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('packs').delete(packId);
    await deleteByIndex(tx.objectStore('files'), 'packId', packId);
    if (deleteRelatedReports) await deleteByIndex(tx.objectStore('reports'), 'packId', packId);
    await transactionDone(tx);
  }

  async function clearStores(storeNames) {
    const tx = db.transaction(storeNames, 'readwrite');
    storeNames.forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
  }

  function isSafePackPath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 240 &&
      !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..');
  }

  async function sha256Hex(bytes) {
    const buffer = bytes instanceof Uint8Array
      ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      : bytes;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function decodePackText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!isGzip) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!('DecompressionStream' in window)) {
      throw new Error('このブラウザはGZIP地域パックを展開できません。非圧縮の .dmap.json を使用してください。');
    }
    const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(decompressed).text();
  }

  function validateFeatureCollection(value, path) {
    if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
      throw new Error(`${path} はGeoJSON FeatureCollectionではありません。`);
    }
  }

  async function parseAndVerifyPack(arrayBuffer, sourceName = '地域パック') {
    updateProgress(`${sourceName}を展開しています…`, 10);
    const text = await decodePackText(arrayBuffer);
    updateProgress('地域パック構造を確認しています…', 20);
    const container = JSON.parse(text);
    if (container.format !== 'disaster-map-pack-container' || container.formatVersion !== 1) {
      throw new Error('未対応の地域パック形式です。');
    }
    const manifest = container.manifest;
    if (!manifest || manifest.format !== 'disaster-map-pack' || manifest.formatVersion !== 1) {
      throw new Error('manifestの形式またはバージョンが不正です。');
    }
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(manifest.id || '')) {
      throw new Error('manifest.id が不正です。英数字、ピリオド、ハイフン、アンダースコアのみ使用できます。');
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 10000) {
      throw new Error('manifest.files が空、またはファイル数が多すぎます。');
    }
    if (!container.files || typeof container.files !== 'object') {
      throw new Error('地域パックのfiles領域がありません。');
    }

    const verifiedFiles = [];
    let totalBytes = 0;
    for (let i = 0; i < manifest.files.length; i += 1) {
      const definition = manifest.files[i];
      if (!isSafePackPath(definition.path)) throw new Error(`不正なファイルパスです: ${definition.path}`);
      const payload = container.files[definition.path];
      if (!payload || typeof payload.data !== 'string') throw new Error(`ファイルがありません: ${definition.path}`);
      let bytes;
      if (payload.encoding === 'utf8') bytes = new TextEncoder().encode(payload.data);
      else if (payload.encoding === 'base64') bytes = base64ToBytes(payload.data);
      else throw new Error(`未対応のエンコードです: ${definition.path}`);

      const actualHash = await sha256Hex(bytes);
      if ((definition.sha256 || '').toLowerCase() !== actualHash) {
        throw new Error(`SHA-256が一致しません: ${definition.path}`);
      }
      if (Number(definition.bytes) !== bytes.byteLength) {
        throw new Error(`ファイルサイズが一致しません: ${definition.path}`);
      }
      if ((definition.mediaType || '').includes('json')) {
        const json = JSON.parse(new TextDecoder().decode(bytes));
        if ((definition.mediaType || '').includes('geo+json')) validateFeatureCollection(json, definition.path);
      }
      totalBytes += bytes.byteLength;
      verifiedFiles.push({
        key: `${manifest.id}::${definition.path}`,
        packId: manifest.id,
        path: definition.path,
        role: definition.role || 'other',
        mediaType: definition.mediaType || 'application/octet-stream',
        bytes: bytes.byteLength,
        sha256: actualHash,
        blob: new Blob([bytes], { type: definition.mediaType || 'application/octet-stream' })
      });
      updateProgress(`整合性検証中 ${i + 1}/${manifest.files.length}`, 20 + Math.round(((i + 1) / manifest.files.length) * 55));
    }

    return { manifest, verifiedFiles, totalBytes };
  }

  async function storeVerifiedPack(parsed) {
    const existing = await dbGet('packs', parsed.manifest.id);
    if (existing) await deletePackData(parsed.manifest.id, false);
    const tx = db.transaction(['packs', 'files'], 'readwrite');
    tx.objectStore('packs').put({
      id: parsed.manifest.id,
      name: parsed.manifest.name || parsed.manifest.id,
      description: parsed.manifest.description || '',
      manifest: parsed.manifest,
      installedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      totalBytes: parsed.totalBytes
    });
    const fileStore = tx.objectStore('files');
    parsed.verifiedFiles.forEach((file) => fileStore.put(file));
    await transactionDone(tx);
  }

  async function installPackBuffer(arrayBuffer, sourceName) {
    showProgress('地域パック導入', `${sourceName}を読み込んでいます…`, 5);
    try {
      const parsed = await parseAndVerifyPack(arrayBuffer, sourceName);
      const existing = await dbGet('packs', parsed.manifest.id);
      if (existing && !confirm(`「${parsed.manifest.name}」は既に導入済みです。上書きしますか？`)) return false;
      updateProgress('端末内ストレージへ保存しています…', 82);
      await storeVerifiedPack(parsed);
      updateProgress('表示データを準備しています…', 95);
      await refreshPackSelect(parsed.manifest.id);
      await activatePack(parsed.manifest.id, true);
      await refreshStorageSummary();
      toast(`地域パック「${parsed.manifest.name}」を導入しました。`, 'success');
      return true;
    } finally {
      hideProgress();
    }
  }

  async function installPackFromUrl(url, displayName = null) {
    const absolute = new URL(url, window.location.href).href;
    showProgress('地域パック取得', `${displayName || absolute}をダウンロードしています…`, null);
    try {
      const response = await fetch(absolute, { cache: 'no-store' });
      if (!response.ok) throw new Error(`ダウンロードに失敗しました: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      hideProgress();
      return installPackBuffer(buffer, displayName || absolute);
    } catch (error) {
      hideProgress();
      throw error;
    }
  }

  async function readPackRoleJson(packId, manifest, role) {
    const definitions = manifest.files.filter((item) => item.role === role);
    const merged = featureCollection();
    for (const definition of definitions) {
      const record = await dbGet('files', `${packId}::${definition.path}`);
      if (!record) throw new Error(`保存ファイルが見つかりません: ${definition.path}`);
      const json = JSON.parse(await record.blob.text());
      validateFeatureCollection(json, definition.path);
      merged.features.push(...json.features);
    }
    return merged;
  }

  async function loadPackDataset(packRecord) {
    const roles = ['basemap', 'buildings', 'hazards', 'routes', 'shelters', 'weather'];
    const data = emptyDataset();
    for (const role of roles) data[role] = await readPackRoleJson(packRecord.id, packRecord.manifest, role);
    return data;
  }

  async function verifyStoredPack(packRecord) {
    const results = [];
    for (const definition of packRecord.manifest.files) {
      const record = await dbGet('files', `${packRecord.id}::${definition.path}`);
      if (!record) throw new Error(`欠落: ${definition.path}`);
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      const hash = await sha256Hex(bytes);
      if (hash !== definition.sha256) throw new Error(`破損: ${definition.path}`);
      results.push(definition.path);
    }
    return results;
  }

  class GeoCanvasRenderer {
    constructor(canvas, popup, callbacks = {}) {
      this.canvas = canvas;
      this.popup = popup;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.callbacks = callbacks;
      this.data = emptyDataset();
      this.reports = [];
      this.currentLocation = null;
      this.center = [135, 35];
      this.zoom = 14;
      this.pitch = 52;
      this.comparison = 0.65;
      this.selectedFeatureId = null;
      this.layers = {
        basemap: true,
        buildings: true,
        hazards: true,
        routes: true,
        shelters: true,
        weather: true,
        reports: true
      };
      this.hitFeatures = [];
      this.drag = null;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.bindEvents();
      this.resize();
    }

    bindEvents() {
      this.canvas.addEventListener('pointerdown', (event) => {
        this.canvas.setPointerCapture(event.pointerId);
        this.drag = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startCenter: this.lngLatToWorld(this.center[0], this.center[1]),
          moved: false
        };
        this.hidePopup();
      });
      this.canvas.addEventListener('pointermove', (event) => {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return;
        const dx = event.clientX - this.drag.startX;
        const dy = event.clientY - this.drag.startY;
        if (Math.hypot(dx, dy) > 4) this.drag.moved = true;
        const scale = this.worldSize();
        const pitchFactor = Math.max(0.25, Math.cos(this.pitchRadians()));
        const worldX = this.drag.startCenter.x - dx / scale;
        const worldY = this.drag.startCenter.y - dy / (scale * pitchFactor);
        this.center = this.worldToLngLat(worldX, Math.max(0.001, Math.min(0.999, worldY)));
        this.render();
      });
      const endDrag = (event) => {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return;
        const wasMoved = this.drag.moved;
        this.drag = null;
        if (!wasMoved) this.handleClick(event.offsetX, event.offsetY);
        this.emitViewChanged();
      };
      this.canvas.addEventListener('pointerup', endDrag);
      this.canvas.addEventListener('pointercancel', endDrag);
      this.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        this.setZoom(this.zoom + (event.deltaY < 0 ? 0.55 : -0.55));
      }, { passive: false });
      this.canvas.addEventListener('dblclick', (event) => {
        event.preventDefault();
        this.setZoom(this.zoom + 1);
      });
      this.canvas.addEventListener('keydown', (event) => {
        const pan = 70;
        if (event.key === '+' || event.key === '=') this.setZoom(this.zoom + 0.5);
        else if (event.key === '-') this.setZoom(this.zoom - 0.5);
        else if (event.key === 'ArrowLeft') this.panPixels(pan, 0);
        else if (event.key === 'ArrowRight') this.panPixels(-pan, 0);
        else if (event.key === 'ArrowUp') this.panPixels(0, pan);
        else if (event.key === 'ArrowDown') this.panPixels(0, -pan);
        else return;
        event.preventDefault();
      });
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.width = rect.width;
        this.height = rect.height;
      }
      this.render();
    }

    setData(data, reportsValue = []) {
      this.data = data || emptyDataset();
      this.reports = reportsValue;
      this.render();
    }

    setReports(value) {
      this.reports = value || [];
      this.render();
    }

    setLayer(name, visible) {
      this.layers[name] = Boolean(visible);
      this.render();
    }

    setComparison(value) {
      this.comparison = Math.max(0, Math.min(1, Number(value)));
      this.render();
    }

    setSelectedFeature(id) {
      this.selectedFeatureId = id || null;
      this.render();
    }

    setCurrentLocation(location) {
      this.currentLocation = location;
      this.render();
    }

    getCenter() { return [...this.center]; }
    getView() { return { center: [...this.center], zoom: this.zoom, pitch: this.pitch }; }

    setView(view, notify = true) {
      if (Array.isArray(view.center) && view.center.length === 2) this.center = [Number(view.center[0]), Number(view.center[1])];
      if (Number.isFinite(Number(view.zoom))) this.zoom = Math.max(2, Math.min(21, Number(view.zoom)));
      if (Number.isFinite(Number(view.pitch))) this.pitch = Math.max(0, Math.min(65, Number(view.pitch)));
      this.render();
      if (notify) this.emitViewChanged();
    }

    setZoom(value) {
      this.zoom = Math.max(2, Math.min(21, Number(value)));
      this.render();
      this.emitViewChanged();
    }

    panPixels(dx, dy) {
      const centerWorld = this.lngLatToWorld(this.center[0], this.center[1]);
      const scale = this.worldSize();
      const pitchFactor = Math.max(0.25, Math.cos(this.pitchRadians()));
      this.center = this.worldToLngLat(centerWorld.x - dx / scale, centerWorld.y - dy / (scale * pitchFactor));
      this.render();
      this.emitViewChanged();
    }

    toggle3D() {
      this.pitch = this.pitch > 5 ? 0 : 52;
      this.render();
      this.emitViewChanged();
      return this.pitch > 5;
    }

    fitBounds(bounds) {
      if (!Array.isArray(bounds) || bounds.length !== 4) return;
      const [west, south, east, north] = bounds.map(Number);
      const a = this.lngLatToWorld(west, north);
      const b = this.lngLatToWorld(east, south);
      const dx = Math.max(Math.abs(b.x - a.x), 1e-9);
      const dy = Math.max(Math.abs(b.y - a.y), 1e-9);
      const usableW = Math.max(100, this.width - 90);
      const usableH = Math.max(100, this.height - 90);
      const pitchFactor = Math.max(0.3, Math.cos(this.pitchRadians()));
      const zoomX = Math.log2(usableW / (512 * dx));
      const zoomY = Math.log2(usableH / (512 * dy * pitchFactor));
      this.center = [(west + east) / 2, (south + north) / 2];
      this.zoom = Math.max(2, Math.min(21, Math.min(zoomX, zoomY)));
      this.render();
      this.emitViewChanged();
    }

    flyTo(lngLat, zoom = null) {
      this.center = [Number(lngLat[0]), Number(lngLat[1])];
      if (zoom !== null) this.zoom = Math.max(2, Math.min(21, Number(zoom)));
      this.render();
      this.emitViewChanged();
    }

    emitViewChanged() {
      if (typeof this.callbacks.onViewChanged === 'function') this.callbacks.onViewChanged(this.getView());
    }

    pitchRadians() { return this.pitch * Math.PI / 180; }
    worldSize() { return 512 * (2 ** this.zoom); }

    lngLatToWorld(lng, lat) {
      const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
      const sin = Math.sin(clampedLat * Math.PI / 180);
      return {
        x: (Number(lng) + 180) / 360,
        y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
      };
    }

    worldToLngLat(x, y) {
      const lng = x * 360 - 180;
      const n = Math.PI - 2 * Math.PI * y;
      const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
      return [lng, lat];
    }

    project(coord) {
      const world = this.lngLatToWorld(coord[0], coord[1]);
      const centerWorld = this.lngLatToWorld(this.center[0], this.center[1]);
      const scale = this.worldSize();
      let dx = world.x - centerWorld.x;
      if (dx > 0.5) dx -= 1;
      if (dx < -0.5) dx += 1;
      const dy = world.y - centerWorld.y;
      return [
        this.width / 2 + dx * scale,
        this.height / 2 + dy * scale * Math.max(0.25, Math.cos(this.pitchRadians()))
      ];
    }

    heightPixels(heightMeters, latitude = this.center[1]) {
      if (this.pitch <= 1) return 0;
      const earthCircumference = 40075016.686;
      const pixelsPerMeter = this.worldSize() / (earthCircumference * Math.max(0.15, Math.cos(latitude * Math.PI / 180)));
      return Math.max(1, Number(heightMeters || 6) * pixelsPerMeter * Math.sin(this.pitchRadians()));
    }

    colorMix(a, b, amount) {
      const parse = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
      const ca = parse(a);
      const cb = parse(b);
      const c = ca.map((value, index) => Math.round(value + (cb[index] - value) * amount));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }

    buildingColor(properties) {
      const damage = Math.max(0, Math.min(1, Number(properties.damage_score || 0)));
      const amount = damage * this.comparison;
      if (properties.confirmed_status === 'safe') return this.colorMix('#8999a4', '#3ba776', this.comparison * 0.8);
      if (properties.confirmed_status === 'destroyed') return this.colorMix('#8999a4', '#8f1d1d', Math.max(0.65, this.comparison));
      return this.colorMix('#8999a4', '#d8443f', amount);
    }

    render() {
      if (!this.ctx || !this.width || !this.height) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#dce4e8';
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawGrid();
      this.hitFeatures = [];
      if (this.layers.basemap) this.drawBasemap();
      if (this.layers.hazards) this.drawHazards();
      if (this.layers.buildings) this.drawBuildings();
      if (this.layers.routes) this.drawRoutes();
      if (this.layers.shelters) this.drawPointFeatures(this.data.shelters.features, 'shelter');
      if (this.layers.weather) this.drawPointFeatures(this.data.weather.features, 'weather');
      if (this.layers.reports) this.drawReports();
      if (this.currentLocation) this.drawCurrentLocation();
      ctx.restore();
      this.updateScale();
    }

    drawGrid() {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(85, 102, 113, .14)';
      ctx.lineWidth = 1;
      const spacing = 64;
      const centerWorld = this.lngLatToWorld(this.center[0], this.center[1]);
      const scale = this.worldSize();
      const offsetX = ((-centerWorld.x * scale + this.width / 2) % spacing + spacing) % spacing;
      const offsetY = ((-centerWorld.y * scale + this.height / 2) % spacing + spacing) % spacing;
      for (let x = offsetX; x < this.width; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
      }
      for (let y = offsetY; y < this.height; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
      }
      ctx.restore();
    }

    geometryParts(geometry) {
      if (!geometry) return [];
      if (geometry.type === 'Polygon') return [geometry.coordinates];
      if (geometry.type === 'MultiPolygon') return geometry.coordinates;
      return [];
    }

    lineParts(geometry) {
      if (!geometry) return [];
      if (geometry.type === 'LineString') return [geometry.coordinates];
      if (geometry.type === 'MultiLineString') return geometry.coordinates;
      return [];
    }

    drawPath(rings, offsetY = 0) {
      const ctx = this.ctx;
      ctx.beginPath();
      rings.forEach((ring) => {
        ring.forEach((coord, index) => {
          const [x, y] = this.project(coord);
          if (index === 0) ctx.moveTo(x, y - offsetY);
          else ctx.lineTo(x, y - offsetY);
        });
        ctx.closePath();
      });
    }

    drawBasemap() {
      const ctx = this.ctx;
      const polygons = this.data.basemap.features.filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type));
      const lines = this.data.basemap.features.filter((f) => ['LineString', 'MultiLineString'].includes(f.geometry?.type));
      polygons.forEach((feature) => {
        const kind = feature.properties?.kind || 'land';
        const fill = kind === 'water' ? '#9bc7dd' : kind === 'park' ? '#b7d1ad' : '#d8ded9';
        this.geometryParts(feature.geometry).forEach((rings) => {
          this.drawPath(rings);
          ctx.fillStyle = fill;
          ctx.fill('evenodd');
          ctx.strokeStyle = 'rgba(70, 90, 100, .35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      });
      lines.forEach((feature) => {
        const kind = feature.properties?.kind || 'road';
        const status = feature.properties?.status || 'open';
        let color = kind === 'river' ? '#4d91b5' : '#f6f2e9';
        if (status === 'blocked') color = '#c83838';
        const width = Math.max(1.5, Number(feature.properties?.width || 3));
        this.lineParts(feature.geometry).forEach((line) => this.drawLine(line, color, width, kind === 'road' ? '#6e7880' : null));
      });
    }

    drawHazards() {
      const ctx = this.ctx;
      const opacity = 0.1 + this.comparison * 0.45;
      this.data.hazards.features.forEach((feature) => {
        const type = feature.properties?.hazard_type || 'change';
        const fill = type === 'flood' ? `rgba(49, 124, 192, ${opacity})` :
          type === 'landslide' ? `rgba(166, 104, 41, ${opacity})` : `rgba(221, 65, 55, ${opacity})`;
        this.geometryParts(feature.geometry).forEach((rings) => {
          this.drawPath(rings);
          ctx.fillStyle = fill;
          ctx.fill('evenodd');
          ctx.strokeStyle = type === 'flood' ? '#317cc0' : '#b8312b';
          ctx.lineWidth = 2;
          ctx.setLineDash([7, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      });
    }

    drawBuildings() {
      const ctx = this.ctx;
      const entries = [];
      this.data.buildings.features.forEach((feature) => {
        this.geometryParts(feature.geometry).forEach((rings) => {
          if (!rings[0]?.length) return;
          const ground = rings[0].map((coord) => this.project(coord));
          const centerY = ground.reduce((sum, point) => sum + point[1], 0) / ground.length;
          entries.push({ feature, rings, ground, centerY });
        });
      });
      entries.sort((a, b) => a.centerY - b.centerY);
      entries.forEach(({ feature, rings, ground }) => {
        const props = feature.properties || {};
        const height = this.heightPixels(props.height || ((props.levels || 2) * 3), rings[0][0][1]);
        const color = this.buildingColor(props);
        if (height > 0.5) {
          for (let i = 0; i < ground.length - 1; i += 1) {
            const a = ground[i];
            const b = ground[i + 1];
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.lineTo(b[0], b[1] - height);
            ctx.lineTo(a[0], a[1] - height);
            ctx.closePath();
            ctx.fillStyle = this.colorMix(color.startsWith('#') ? color : '#8999a4', '#263943', 0.35);
            ctx.fill();
            ctx.strokeStyle = 'rgba(36, 51, 61, .65)';
            ctx.stroke();
          }
        }
        this.drawPath(rings, height);
        ctx.fillStyle = color;
        ctx.fill('evenodd');
        const selected = this.selectedFeatureId && String(props.id || feature.id) === String(this.selectedFeatureId);
        ctx.strokeStyle = selected ? '#ffef6a' : '#475963';
        ctx.lineWidth = selected ? 3 : 1;
        ctx.stroke();
        const topPolygon = ground.map(([x, y]) => [x, y - height]);
        this.hitFeatures.push({ feature, polygon: topPolygon });
        if (this.zoom >= 17 && props.name) {
          const point = this.polygonCentroid(topPolygon);
          ctx.fillStyle = '#1d2a32';
          ctx.font = '11px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(String(props.name).slice(0, 28), point[0], point[1] - 4);
        }
      });
    }

    drawRoutes() {
      this.data.routes.features.forEach((feature) => {
        const status = feature.properties?.status || 'open';
        const color = status === 'blocked' ? '#c42f2f' : status === 'restricted' ? '#d58a25' : '#278b61';
        this.lineParts(feature.geometry).forEach((line) => this.drawLine(line, color, 5, '#f5f7f8', status === 'blocked' ? [9, 5] : []));
      });
    }

    drawLine(coords, color, width, casing = null, dash = []) {
      if (!coords || coords.length < 2) return;
      const ctx = this.ctx;
      const draw = (stroke, lineWidth) => {
        ctx.beginPath();
        coords.forEach((coord, index) => {
          const point = this.project(coord);
          if (index === 0) ctx.moveTo(point[0], point[1]);
          else ctx.lineTo(point[0], point[1]);
        });
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash(dash);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (casing) draw(casing, width + 2);
      draw(color, width);
    }

    drawPointFeatures(features, type) {
      const ctx = this.ctx;
      features.forEach((feature) => {
        if (feature.geometry?.type !== 'Point') return;
        const [x, y] = this.project(feature.geometry.coordinates);
        const properties = feature.properties || {};
        ctx.beginPath();
        ctx.arc(x, y, type === 'shelter' ? 8 : 7, 0, Math.PI * 2);
        ctx.fillStyle = type === 'shelter' ? '#276fb3' : '#7b4db0';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#17242d';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(String(properties.name || properties.summary || type), x + 11, y + 4);
        this.hitFeatures.push({ feature, point: [x, y], radius: 12 });
      });
    }

    drawReports() {
      const ctx = this.ctx;
      this.reports.forEach((report) => {
        const [x, y] = this.project([report.longitude, report.latitude]);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = report.status === 'resolved' ? '#36865f' : report.category === 'rescue' ? '#b2284a' : '#e5822d';
        ctx.fillRect(-6, -6, 12, 12);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(-6, -6, 12, 12);
        ctx.restore();
        this.hitFeatures.push({ report, point: [x, y], radius: 13 });
      });
    }

    drawCurrentLocation() {
      const ctx = this.ctx;
      const [x, y] = this.project([this.currentLocation.longitude, this.currentLocation.latitude]);
      const accuracy = Math.max(6, Math.min(80, this.currentLocation.accuracy || 10));
      const meterPixels = this.heightPixels(accuracy) / Math.max(0.2, Math.sin(this.pitchRadians()));
      ctx.beginPath();
      ctx.arc(x, y, Math.max(8, Math.min(60, meterPixels)), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(30, 115, 190, .18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(30, 115, 190, .55)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#1e73be';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    polygonCentroid(points) {
      if (!points.length) return [0, 0];
      return [
        points.reduce((sum, p) => sum + p[0], 0) / points.length,
        points.reduce((sum, p) => sum + p[1], 0) / points.length
      ];
    }

    pointInPolygon(point, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > point[1]) !== (yj > point[1])) &&
          (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    handleClick(x, y) {
      for (let i = this.hitFeatures.length - 1; i >= 0; i -= 1) {
        const hit = this.hitFeatures[i];
        if (hit.polygon && this.pointInPolygon([x, y], hit.polygon)) {
          this.selectedFeatureId = hit.feature.properties?.id || hit.feature.id || null;
          this.render();
          this.showPopupForFeature(hit.feature, x, y);
          if (typeof this.callbacks.onFeatureSelected === 'function') this.callbacks.onFeatureSelected(hit.feature);
          return;
        }
        if (hit.point && Math.hypot(hit.point[0] - x, hit.point[1] - y) <= hit.radius) {
          if (hit.report) this.showPopupForReport(hit.report, x, y);
          else this.showPopupForFeature(hit.feature, x, y);
          return;
        }
      }
      this.selectedFeatureId = null;
      this.hidePopup();
      this.render();
    }

    positionPopup(x, y) {
      const maxX = Math.max(8, this.width - 330);
      const maxY = Math.max(8, this.height - 260);
      this.popup.style.left = `${Math.max(8, Math.min(maxX, x + 12))}px`;
      this.popup.style.top = `${Math.max(8, Math.min(maxY, y + 12))}px`;
      this.popup.hidden = false;
    }

    showPopupForFeature(feature, x, y) {
      const props = feature.properties || {};
      this.popup.replaceChildren();
      const title = document.createElement('h3');
      title.textContent = props.name || props.id || '地物情報';
      this.popup.appendChild(title);
      const dl = document.createElement('dl');
      const values = [
        ['ID', props.id || feature.id || '不明'],
        ['種別', props.kind || props.hazard_type || props.type || '不明'],
        ['高さ', props.height != null ? `${props.height} m` : '不明'],
        ['変化指標', props.damage_score != null ? Number(props.damage_score).toFixed(2) : 'なし'],
        ['確認状態', props.confirmed_status || props.status || '未確認'],
        ['更新', props.updated_at ? formatDate(props.updated_at) : '不明']
      ];
      values.forEach(([key, value]) => {
        const dt = document.createElement('dt'); dt.textContent = key;
        const dd = document.createElement('dd'); dd.textContent = String(value);
        dl.append(dt, dd);
      });
      this.popup.appendChild(dl);
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'close-popup'; close.textContent = '閉じる';
      close.addEventListener('click', () => this.hidePopup());
      this.popup.appendChild(close);
      this.positionPopup(x, y);
    }

    showPopupForReport(report, x, y) {
      this.popup.replaceChildren();
      const title = document.createElement('h3');
      title.textContent = '現地調査記録';
      this.popup.appendChild(title);
      const dl = document.createElement('dl');
      [
        ['種別', report.category],
        ['状態', report.status],
        ['メモ', report.note || 'なし'],
        ['座標', `${report.latitude.toFixed(6)}, ${report.longitude.toFixed(6)}`],
        ['更新', formatDate(report.updatedAt)]
      ].forEach(([key, value]) => {
        const dt = document.createElement('dt'); dt.textContent = key;
        const dd = document.createElement('dd'); dd.textContent = String(value);
        dl.append(dt, dd);
      });
      this.popup.appendChild(dl);
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'close-popup'; close.textContent = '閉じる';
      close.addEventListener('click', () => this.hidePopup());
      this.popup.appendChild(close);
      this.positionPopup(x, y);
    }

    hidePopup() { this.popup.hidden = true; }

    updateScale() {
      const latitude = this.center[1] * Math.PI / 180;
      const metersPerPixel = (40075016.686 * Math.cos(latitude)) / this.worldSize();
      const targetPixels = 120;
      const targetMeters = metersPerPixel * targetPixels;
      const power = 10 ** Math.floor(Math.log10(Math.max(targetMeters, 1e-6)));
      const normalized = targetMeters / power;
      const nice = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
      const distance = nice * power;
      const pixels = distance / metersPerPixel;
      const label = distance >= 1000 ? `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)} km` : `${Math.round(distance)} m`;
      dom.mapScale.textContent = `${label}（約${Math.round(pixels)} px） / Zoom ${this.zoom.toFixed(1)}`;
    }
  }

  const renderer = new GeoCanvasRenderer(dom.mapCanvas, dom.mapPopup, {
    onViewChanged: (view) => {
      clearTimeout(persistViewTimer);
      persistViewTimer = setTimeout(() => {
        if (activePack) setSetting(`view:${activePack.id}`, view).catch(console.error);
      }, 500);
    }
  });

  function featureCenter(feature) {
    const geometry = feature.geometry;
    if (!geometry) return null;
    if (geometry.type === 'Point') return geometry.coordinates;
    let coords = [];
    if (geometry.type === 'Polygon') coords = geometry.coordinates[0] || [];
    else if (geometry.type === 'MultiPolygon') coords = geometry.coordinates[0]?.[0] || [];
    else if (geometry.type === 'LineString') coords = geometry.coordinates;
    if (!coords.length) return null;
    return [
      coords.reduce((sum, c) => sum + Number(c[0]), 0) / coords.length,
      coords.reduce((sum, c) => sum + Number(c[1]), 0) / coords.length
    ];
  }

  async function refreshPackSelect(preferredId = null) {
    const packs = (await dbGetAll('packs')).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    const desired = preferredId || dom.packSelect.value || await getSetting('activePackId', '');
    dom.packSelect.replaceChildren();
    const none = document.createElement('option');
    none.value = ''; none.textContent = '未選択';
    dom.packSelect.appendChild(none);
    packs.forEach((pack) => {
      const option = document.createElement('option');
      option.value = pack.id;
      option.textContent = `${pack.name} (${formatBytes(pack.totalBytes)})`;
      dom.packSelect.appendChild(option);
    });
    if (packs.some((pack) => pack.id === desired)) dom.packSelect.value = desired;
    return packs;
  }

  async function activatePack(packId, fitHome = false) {
    if (!packId) {
      activePack = null;
      activeData = emptyDataset();
      reports = [];
      renderer.setData(activeData, reports);
      dom.emptyMapMessage.hidden = false;
      dom.packBadge.textContent = '地域パック未選択';
      dom.packDetails.textContent = '地域パックを選択してください。';
      dom.deleteActivePackButton.disabled = true;
      dom.attributionText.textContent = '本アプリ：災害オフライン3Dマップ。地域データ未選択。';
      await setSetting('activePackId', '');
      renderReportList();
      updateStaleBanner();
      return;
    }
    showProgress('地域データ読込', '端末内の地域パックを読み込んでいます…', null);
    try {
      const pack = await dbGet('packs', packId);
      if (!pack) throw new Error('地域パックが見つかりません。');
      const data = await loadPackDataset(pack);
      activePack = pack;
      activeData = data;
      reports = await dbGetAllByIndex('reports', 'packId', packId);
      reports.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      renderer.setData(activeData, reports);
      const savedView = await getSetting(`view:${packId}`, null);
      if (savedView && !fitHome) renderer.setView(savedView, false);
      else if (Array.isArray(pack.manifest.bounds)) renderer.fitBounds(pack.manifest.bounds);
      else renderer.setView({ center: pack.manifest.center || [135, 35], zoom: pack.manifest.zoom || 14, pitch: 52 }, false);
      dom.emptyMapMessage.hidden = true;
      dom.packBadge.textContent = pack.name;
      dom.packBadge.className = 'badge';
      dom.deleteActivePackButton.disabled = false;
      dom.packSelect.value = pack.id;
      await setSetting('activePackId', pack.id);
      renderPackDetails();
      renderReportList();
      updateAttribution();
      updateStaleBanner();
    } finally {
      hideProgress();
    }
  }

  function renderPackDetails() {
    if (!activePack) return;
    const manifest = activePack.manifest;
    dom.packDetails.replaceChildren();
    const lines = [
      `名称：${activePack.name}`,
      `ID：${activePack.id}`,
      `データ更新：${formatDate(manifest.dataUpdatedAt)}`,
      `導入：${formatDate(activePack.installedAt)}`,
      `検証：${formatDate(activePack.verifiedAt)}`,
      `容量：${formatBytes(activePack.totalBytes)}`,
      `建物：${activeData.buildings.features.length}件 / 危険領域：${activeData.hazards.features.length}件`,
      manifest.disclaimer ? `注意：${manifest.disclaimer}` : ''
    ].filter(Boolean);
    lines.forEach((text) => {
      const div = document.createElement('div'); div.textContent = text; dom.packDetails.appendChild(div);
    });
  }

  function updateAttribution() {
    if (!activePack) return;
    const attributions = Array.isArray(activePack.manifest.attributions) ? activePack.manifest.attributions : [];
    const texts = attributions.map((item) => typeof item === 'string' ? item : item.text).filter(Boolean);
    texts.unshift('アプリ：災害オフライン3Dマップ');
    dom.attributionText.textContent = texts.join(' ｜ ');
  }

  function updateNetworkStatus() {
    const online = navigator.onLine;
    dom.networkBadge.textContent = online ? 'オンライン' : 'オフライン';
    dom.networkBadge.className = `badge ${online ? 'badge-online' : 'badge-offline'}`;
    updateStaleBanner();
  }

  function updateStaleBanner() {
    const offline = !navigator.onLine;
    dom.staleBanner.hidden = !offline;
    if (offline) {
      const updated = activePack?.manifest?.dataUpdatedAt;
      dom.staleText.textContent = updated
        ? `地域データ最終更新：${formatDate(updated)}。新しい警報・衛星解析・他端末の記録は取得できません。`
        : '表示中の情報は最後に端末へ保存された時点のものです。';
    }
  }

  function renderSearchResults(features) {
    dom.searchResults.replaceChildren();
    if (!features.length) {
      dom.searchResults.textContent = '該当する建物・地点はありません。';
      return;
    }
    features.slice(0, 20).forEach((feature) => {
      const props = feature.properties || {};
      const item = document.createElement('div');
      item.className = 'result-item';
      const title = document.createElement('strong');
      title.textContent = props.name || props.id || '名称なし';
      const meta = document.createElement('div');
      meta.textContent = `ID: ${props.id || feature.id || '不明'} / 変化指標: ${props.damage_score ?? 'なし'}`;
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = '地図で表示';
      button.addEventListener('click', () => {
        const center = featureCenter(feature);
        if (center) renderer.flyTo(center, Math.max(renderer.zoom, 17));
        renderer.setSelectedFeature(props.id || feature.id || null);
      });
      item.append(title, meta, button);
      dom.searchResults.appendChild(item);
    });
  }

  function runSearch() {
    const term = dom.searchInput.value.trim().toLocaleLowerCase('ja');
    if (!activePack) {
      dom.searchResults.textContent = '地域パックを選択してください。';
      return;
    }
    if (!term) {
      dom.searchResults.textContent = '建物IDまたは名称を入力してください。';
      return;
    }
    const result = activeData.buildings.features.filter((feature) => {
      const props = feature.properties || {};
      return [props.id, props.name, props.address, feature.id].filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ja').includes(term));
    });
    renderSearchResults(result);
  }

  function reportCategoryLabel(value) {
    return ({ unconfirmed: '未確認', damage: '建物被害', blocked: '道路閉塞', rescue: '要救助・救助活動', safe: '安全確認', medical: '医療・救護', other: 'その他' })[value] || value;
  }

  function reportStatusLabel(value) {
    return ({ open: '対応中', confirmed: '確認済み', resolved: '完了' })[value] || value;
  }

  function renderReportList() {
    dom.reportList.replaceChildren();
    if (!activePack) {
      dom.reportList.textContent = '地域パックを選択すると記録を表示します。';
      return;
    }
    if (!reports.length) {
      dom.reportList.textContent = 'この地域の調査記録はありません。';
      return;
    }
    reports.slice(0, 30).forEach((report) => {
      const item = document.createElement('div'); item.className = 'report-item';
      const title = document.createElement('strong');
      title.textContent = `${reportCategoryLabel(report.category)} / ${reportStatusLabel(report.status)}`;
      const note = document.createElement('div'); note.textContent = report.note || 'メモなし';
      const meta = document.createElement('div');
      meta.textContent = `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)} / ${formatDate(report.updatedAt)}`;
      const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = '地図で表示';
      locate.addEventListener('click', () => renderer.flyTo([report.longitude, report.latitude], Math.max(renderer.zoom, 17)));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger-outline'; remove.textContent = '削除';
      remove.addEventListener('click', async () => {
        if (!confirm('この調査記録を削除しますか？')) return;
        await dbDelete('reports', report.id);
        reports = reports.filter((itemValue) => itemValue.id !== report.id);
        renderer.setReports(reports);
        renderReportList();
        refreshStorageSummary();
      });
      item.append(title, note, meta, locate, remove);
      dom.reportList.appendChild(item);
    });
  }

  async function addReport() {
    if (!activePack) throw new Error('地域パックを選択してください。');
    let longitude;
    let latitude;
    let accuracy = null;
    if (dom.useCurrentLocation.checked) {
      if (!currentLocation) throw new Error('現在地が未取得です。先に地図右上の「◎」を押してください。');
      ({ longitude, latitude, accuracy } = currentLocation);
    } else {
      [longitude, latitude] = renderer.getCenter();
    }
    const now = new Date().toISOString();
    const report = {
      id: crypto.randomUUID ? crypto.randomUUID() : `report-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      packId: activePack.id,
      category: dom.reportCategory.value,
      status: dom.reportStatus.value,
      note: dom.reportNote.value.trim(),
      longitude,
      latitude,
      accuracy,
      createdAt: now,
      updatedAt: now,
      synced: false
    };
    await dbPut('reports', report);
    reports.unshift(report);
    renderer.setReports(reports);
    dom.reportNote.value = '';
    renderReportList();
    refreshStorageSummary();
    toast('調査記録を端末内に保存しました。', 'success');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportReports() {
    if (!activePack) throw new Error('地域パックを選択してください。');
    const geojson = featureCollection(reports.map((report) => ({
      type: 'Feature',
      id: report.id,
      geometry: { type: 'Point', coordinates: [report.longitude, report.latitude] },
      properties: {
        id: report.id,
        pack_id: report.packId,
        category: report.category,
        status: report.status,
        note: report.note,
        accuracy: report.accuracy,
        created_at: report.createdAt,
        updated_at: report.updatedAt,
        synced: report.synced
      }
    })));
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob(new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }), `${activePack.id}-reports-${date}.geojson`);
  }

  async function importReports(file) {
    if (!activePack) throw new Error('地域パックを選択してください。');
    const json = JSON.parse(await file.text());
    validateFeatureCollection(json, file.name);
    const imported = [];
    for (const feature of json.features) {
      if (feature.geometry?.type !== 'Point' || feature.geometry.coordinates.length < 2) continue;
      const props = feature.properties || {};
      const now = new Date().toISOString();
      imported.push({
        id: String(props.id || feature.id || (crypto.randomUUID ? crypto.randomUUID() : `report-${Date.now()}-${Math.random()}`)),
        packId: activePack.id,
        category: props.category || 'other',
        status: props.status || 'open',
        note: String(props.note || ''),
        longitude: Number(feature.geometry.coordinates[0]),
        latitude: Number(feature.geometry.coordinates[1]),
        accuracy: props.accuracy == null ? null : Number(props.accuracy),
        createdAt: props.created_at || now,
        updatedAt: props.updated_at || now,
        synced: Boolean(props.synced)
      });
    }
    const tx = db.transaction('reports', 'readwrite');
    imported.forEach((report) => tx.objectStore('reports').put(report));
    await transactionDone(tx);
    reports = await dbGetAllByIndex('reports', 'packId', activePack.id);
    reports.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    renderer.setReports(reports);
    renderReportList();
    refreshStorageSummary();
    toast(`${imported.length}件の調査記録を読み込みました。`, 'success');
  }

  async function refreshStorageSummary() {
    let estimate = null;
    let persistent = false;
    if (navigator.storage?.estimate) estimate = await navigator.storage.estimate();
    if (navigator.storage?.persisted) persistent = await navigator.storage.persisted();
    const packCount = (await dbGetAll('packs')).length;
    const reportCount = (await dbGetAll('reports')).length;
    const usage = estimate ? formatBytes(estimate.usage) : '不明';
    const quota = estimate ? formatBytes(estimate.quota) : '不明';
    const ratio = estimate?.quota ? Math.round((estimate.usage / estimate.quota) * 100) : null;
    dom.storageSummary.replaceChildren();
    [
      `使用量：${usage} / 推定上限：${quota}${ratio == null ? '' : ` (${ratio}%)`}`,
      `地域パック：${packCount}件 / 調査記録：${reportCount}件`,
      `永続ストレージ：${persistent ? '許可済み' : '未許可または非対応'}`
    ].forEach((text) => {
      const div = document.createElement('div'); div.textContent = text; dom.storageSummary.appendChild(div);
    });
  }

  async function requestPersistentStorage() {
    if (!navigator.storage?.persist) throw new Error('このブラウザは永続ストレージ要求に対応していません。');
    const accepted = await navigator.storage.persist();
    await refreshStorageSummary();
    toast(accepted ? '永続ストレージが許可されました。' : '永続ストレージは許可されませんでした。地域パックの外部バックアップも保持してください。', accepted ? 'success' : 'error', 6500);
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      return await navigator.serviceWorker.register('./sw.js', { scope: './' });
    } catch (error) {
      console.warn('Service worker registration failed', error);
      return null;
    }
  }

  function sendServiceWorkerMessage(registration, message) {
    return new Promise((resolve, reject) => {
      const worker = registration?.active || navigator.serviceWorker.controller;
      if (!worker) {
        reject(new Error('Service Workerが有効ではありません。ページを再読み込みしてください。'));
        return;
      }
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(new Error('Service Workerの応答がありません。')), 30000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data?.ok) resolve(event.data);
        else reject(new Error(event.data?.error || 'Service Worker処理に失敗しました。'));
      };
      worker.postMessage(message, [channel.port2]);
    });
  }

  function renderOfflineResults(items) {
    dom.offlineCheckResults.replaceChildren();
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = `check-result ${item.status}`;
      const icon = document.createElement('strong');
      icon.textContent = item.status === 'ok' ? '✓' : item.status === 'warn' ? '!' : '×';
      const text = document.createElement('span'); text.textContent = item.text;
      row.append(icon, text);
      dom.offlineCheckResults.appendChild(row);
    });
  }

  async function prepareOffline() {
    const results = [];
    showProgress('完全オフライン検証', 'アプリ本体をキャッシュしています…', 10);
    try {
      const registration = await registerServiceWorker();
      if (!registration) {
        results.push({ status: 'fail', text: 'Service Workerを登録できません。HTTPSまたはlocalhostで開いてください。' });
      } else {
        await navigator.serviceWorker.ready;
        await sendServiceWorkerMessage(registration, { type: 'PRECACHE_ALL' });
        results.push({ status: 'ok', text: 'アプリ本体・アイコン・カタログをキャッシュしました。' });
      }
      updateProgress('キャッシュ内容を照合しています…', 35);
      const missing = [];
      for (const path of OFFLINE_ASSET_PATHS) {
        const response = await caches.match(new URL(path, window.location.href).href);
        if (!response) missing.push(path);
      }
      results.push(missing.length
        ? { status: 'fail', text: `アプリキャッシュ不足：${missing.join(', ')}` }
        : { status: 'ok', text: '必要なアプリファイルがすべて端末内にあります。' });

      updateProgress('地域パックのSHA-256を再検証しています…', 55);
      if (!activePack) {
        results.push({ status: 'warn', text: '地域パックが未選択です。地図データなしでは災害地図を表示できません。' });
      } else {
        const checked = await verifyStoredPack(activePack);
        results.push({ status: 'ok', text: `地域パック ${checked.length}ファイルのSHA-256が一致しました。` });
      }

      updateProgress('端末内データベースの読み書きを試験しています…', 75);
      const testKey = `offline-test-${Date.now()}`;
      await setSetting(testKey, { createdAt: new Date().toISOString() });
      const readBack = await getSetting(testKey, null);
      await dbDelete('settings', testKey);
      results.push(readBack
        ? { status: 'ok', text: 'IndexedDBの読み書き試験に成功しました。' }
        : { status: 'fail', text: 'IndexedDBの読み書き試験に失敗しました。' });

      const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
      results.push(persistent
        ? { status: 'ok', text: '永続ストレージが許可されています。' }
        : { status: 'warn', text: '永続ストレージは未許可です。ブラウザ設定による削除に備えて地域パック原本も保存してください。' });

      updateProgress('描画データを再読込しています…', 90);
      if (activePack) {
        const reloaded = await loadPackDataset(activePack);
        renderer.setData(reloaded, reports);
        results.push({ status: 'ok', text: '端末内データだけで地図を再描画できました。' });
      }
      updateProgress('検証完了', 100);
      renderOfflineResults(results);
      const failed = results.some((item) => item.status === 'fail');
      toast(failed ? 'オフライン検証で問題が見つかりました。' : '完全オフライン検証が完了しました。機内モードでも実地確認してください。', failed ? 'error' : 'success', 7000);
    } finally {
      hideProgress();
    }
  }

  async function clearAppCaches() {
    if (!confirm('アプリ本体のキャッシュを消去しますか？\n地域パックと調査記録は削除されません。通信断中にページを閉じると、再取得まで起動できなくなる場合があります。')) return;
    const names = await caches.keys();
    const targets = names.filter((name) => name.startsWith(CACHE_PREFIX));
    await Promise.all(targets.map((name) => caches.delete(name)));
    renderOfflineResults([{ status: 'warn', text: 'アプリキャッシュを消去しました。オンライン中に「完全オフライン検証」を再実行してください。' }]);
    toast(`${targets.length}個のアプリキャッシュを消去しました。`, 'success');
    refreshStorageSummary();
  }

  async function locateCurrentPosition() {
    if (!navigator.geolocation) throw new Error('この端末は位置情報APIに対応していません。');
    dom.locateButton.disabled = true;
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
      });
      currentLocation = {
        longitude: position.coords.longitude,
        latitude: position.coords.latitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      };
      renderer.setCurrentLocation(currentLocation);
      renderer.flyTo([currentLocation.longitude, currentLocation.latitude], Math.max(renderer.zoom, 16));
      toast(`現在地を取得しました。推定精度 ±${Math.round(currentLocation.accuracy)}m`, 'success');
    } finally {
      dom.locateButton.disabled = false;
    }
  }

  async function deleteActivePack() {
    if (!activePack) return;
    const name = activePack.name;
    if (!confirm(`地域パック「${name}」と、この地域に紐づく端末内の調査記録を削除しますか？\n必要な記録は先にGeoJSONへ書き出してください。`)) return;
    const id = activePack.id;
    await deletePackData(id, true);
    await refreshPackSelect('');
    await activatePack('');
    await refreshStorageSummary();
    toast(`「${name}」を削除しました。`, 'success');
  }

  async function deleteAllPacks() {
    if (!confirm('端末内の全地域パックを削除しますか？\n調査記録は削除されません。')) return;
    await clearStores(['packs', 'files']);
    await refreshPackSelect('');
    await activatePack('');
    await refreshStorageSummary();
    toast('全地域パックを削除しました。', 'success');
  }

  async function deleteAllReports() {
    if (!confirm('端末内の全調査記録を削除しますか？\nこの操作は元に戻せません。')) return;
    await clearStores(['reports']);
    reports = [];
    renderer.setReports(reports);
    renderReportList();
    await refreshStorageSummary();
    toast('全調査記録を削除しました。', 'success');
  }

  async function fullReset() {
    const token = prompt('アプリ本体キャッシュ、全地域パック、全調査記録、設定を完全に削除します。\n実行する場合は RESET と入力してください。');
    if (token !== 'RESET') return;
    showProgress('完全初期化', '端末内データを削除しています…', null);
    try {
      if (db) db.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('データベース削除に失敗しました。'));
        request.onblocked = () => reject(new Error('別タブが使用中のため削除できません。別タブを閉じてください。'));
      });
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)));
      if ('serviceWorker' in navigator) {
        const base = new URL('./', window.location.href).href;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.filter((registration) => registration.scope.startsWith(base)).map((registration) => registration.unregister()));
      }
      window.location.replace(`${new URL('./', window.location.href).href}?reset=${Date.now()}`);
    } catch (error) {
      hideProgress();
      throw error;
    }
  }

  async function loadCatalog() {
    try {
      const response = await fetch('./data/catalog.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      catalog = Array.isArray(json.packs) ? json.packs : [];
    } catch (error) {
      console.warn('catalog load failed', error);
      catalog = [{ id: 'training-sample-v1', name: '架空訓練地域サンプル', url: './data/packs/training-sample.dmap', fallbackUrl: './data/packs/training-sample.dmap.json' }];
    }
  }

  function bindEvents() {
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    dom.sidebarToggle.addEventListener('click', () => {
      const collapsed = dom.sidebar.classList.toggle('collapsed');
      dom.workspace.classList.toggle('sidebar-collapsed', collapsed);
      dom.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
      setTimeout(() => renderer.resize(), 50);
    });
    dom.packSelect.addEventListener('change', () => activatePack(dom.packSelect.value).catch(handleError));
    dom.installSampleButton.addEventListener('click', async () => {
      try {
        const entry = catalog[0];
        if (!entry) throw new Error('カタログに訓練パックがありません。');
        try {
          await installPackFromUrl(entry.url, entry.name);
        } catch (error) {
          if (entry.fallbackUrl && String(error.message).includes('GZIP')) await installPackFromUrl(entry.fallbackUrl, `${entry.name}（非圧縮）`);
          else throw error;
        }
      } catch (error) { handleError(error); }
    });
    dom.importPackButton.addEventListener('click', () => dom.packFileInput.click());
    dom.packFileInput.addEventListener('change', async () => {
      const file = dom.packFileInput.files?.[0];
      dom.packFileInput.value = '';
      if (!file) return;
      try { await installPackBuffer(await file.arrayBuffer(), file.name); } catch (error) { handleError(error); }
    });
    dom.installUrlButton.addEventListener('click', async () => {
      const url = dom.packUrlInput.value.trim();
      if (!url) return;
      try { await installPackFromUrl(url); } catch (error) { handleError(error); }
    });
    dom.deleteActivePackButton.addEventListener('click', () => deleteActivePack().catch(handleError));

    document.querySelectorAll('[data-layer]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => renderer.setLayer(checkbox.dataset.layer, checkbox.checked));
    });
    dom.compareSlider.addEventListener('input', () => {
      const value = Number(dom.compareSlider.value);
      dom.compareValue.textContent = `${value}%`;
      renderer.setComparison(value / 100);
    });
    dom.searchButton.addEventListener('click', runSearch);
    dom.searchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });

    dom.addReportButton.addEventListener('click', () => addReport().catch(handleError));
    dom.exportReportsButton.addEventListener('click', () => { try { exportReports(); } catch (error) { handleError(error); } });
    dom.importReportsButton.addEventListener('click', () => dom.reportFileInput.click());
    dom.reportFileInput.addEventListener('change', async () => {
      const file = dom.reportFileInput.files?.[0];
      dom.reportFileInput.value = '';
      if (!file) return;
      try { await importReports(file); } catch (error) { handleError(error); }
    });

    dom.requestPersistButton.addEventListener('click', () => requestPersistentStorage().catch(handleError));
    dom.prepareOfflineButton.addEventListener('click', () => prepareOffline().catch(handleError));
    dom.clearCacheButton.addEventListener('click', () => clearAppCaches().catch(handleError));
    dom.deleteReportsButton.addEventListener('click', () => deleteAllReports().catch(handleError));
    dom.deleteAllPacksButton.addEventListener('click', () => deleteAllPacks().catch(handleError));
    dom.fullResetButton.addEventListener('click', () => fullReset().catch(handleError));

    dom.zoomInButton.addEventListener('click', () => renderer.setZoom(renderer.zoom + 0.7));
    dom.zoomOutButton.addEventListener('click', () => renderer.setZoom(renderer.zoom - 0.7));
    dom.toggle3dButton.addEventListener('click', () => {
      const enabled = renderer.toggle3D();
      dom.toggle3dButton.textContent = enabled ? '3D' : '2D';
    });
    dom.locateButton.addEventListener('click', () => locateCurrentPosition().catch(handleError));
    dom.homeViewButton.addEventListener('click', () => {
      if (activePack?.manifest?.bounds) renderer.fitBounds(activePack.manifest.bounds);
      else if (activePack) renderer.setView({ center: activePack.manifest.center || [135, 35], zoom: activePack.manifest.zoom || 14, pitch: renderer.pitch });
    });
  }

  function handleError(error) {
    console.error(error);
    hideProgress();
    toast(error?.message || String(error), 'error', 7500);
  }

  async function init() {
    dom.versionBadge.textContent = `ver ${APP_VERSION}`;
    updateNetworkStatus();
    bindEvents();
    await registerServiceWorker();
    db = await openDatabase();
    await loadCatalog();
    const packs = await refreshPackSelect();
    const desired = await getSetting('activePackId', packs[0]?.id || '');
    if (desired && packs.some((pack) => pack.id === desired)) await activatePack(desired);
    else await activatePack('');
    await refreshStorageSummary();
    renderer.setComparison(Number(dom.compareSlider.value) / 100);
  }

  init().catch(handleError);
})();
