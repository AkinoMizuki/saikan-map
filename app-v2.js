(() => {
  'use strict';

  const APP_VERSION = '0.2.0';
  const DB_NAME = 'disaster-offline-map-v1';
  const DB_VERSION = 2;
  const CACHE_PREFIX = 'domap-shell-';
  const OSM_ATTRIBUTION = '背景地図：© OpenStreetMap contributors';
  const DEFAULT_VIEW = { center: [138.0, 36.0], zoom: 5.5, pitch: 0, bearing: 0 };

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
    catalogSelect: $('catalogSelect'),
    packSelect: $('packSelect'),
    installCatalogButton: $('installSampleButton'),
    importPackButton: $('importPackButton'),
    packFileInput: $('packFileInput'),
    packUrlInput: $('packUrlInput'),
    installUrlButton: $('installUrlButton'),
    packDetails: $('packDetails'),
    deleteActivePackButton: $('deleteActivePackButton'),
    alos2ProductSelect: $('alos2ProductSelect'),
    installAlos2Button: $('installAlos2Button'),
    clearAlos2Button: $('clearAlos2Button'),
    alos2Opacity: $('alos2Opacity'),
    alos2Info: $('alos2Info'),
    osmBasemap: $('osmBasemap'),
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
    bearingResetButton: $('bearingResetButton'),
    bearingBadge: $('bearingBadge'),
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
  let regionCatalog = [];
  let alosCatalog = { products: [], officialIndexUrl: '' };
  let activePack = null;
  let activeData = emptyDataset();
  let reports = [];
  let currentLocation = null;
  let persistViewTimer = null;

  function featureCollection(features = []) {
    return { type: 'FeatureCollection', features };
  }

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

  function toast(message, type = 'info', timeout = 4500) {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    dom.toastRegion.appendChild(item);
    setTimeout(() => item.remove(), timeout);
  }

  function showProgress(title, message, value = null) {
    dom.progressTitle.textContent = title;
    dom.progressMessage.textContent = message;
    if (value === null) dom.progressBar.removeAttribute('value');
    else dom.progressBar.value = value;
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
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function formatDate(value) {
    if (!value) return '不明';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ja-JP');
  }

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('packs')) database.createObjectStore('packs', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('files')) {
          const store = database.createObjectStore('files', { keyPath: 'key' });
          store.createIndex('packId', 'packId', { unique: false });
        }
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('reports')) {
          const store = database.createObjectStore('reports', { keyPath: 'id' });
          store.createIndex('packId', 'packId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains('layers')) database.createObjectStore('layers', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDBを開けません。'));
      request.onblocked = () => reject(new Error('別タブがデータベースを使用中です。別タブを閉じてください。'));
    });
  }

  async function dbGet(storeName, key) {
    return requestPromise(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
  }

  async function dbGetAll(storeName) {
    return requestPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  }

  async function dbGetAllByIndex(storeName, indexName, key) {
    const index = db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName);
    return requestPromise(index.getAll(IDBKeyRange.only(key)));
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

  async function clearStores(names) {
    const tx = db.transaction(names, 'readwrite');
    names.forEach((name) => tx.objectStore(name).clear());
    await transactionDone(tx);
  }

  async function getSetting(key, fallback = null) {
    const value = await dbGet('settings', key);
    return value ? value.value : fallback;
  }

  async function setSetting(key, value) {
    await dbPut('settings', { key, value });
  }

  function deleteByIndex(store, indexName, key) {
    return new Promise((resolve, reject) => {
      const request = store.index(indexName).openCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error('削除処理に失敗しました。'));
    });
  }

  async function deletePackData(packId, deleteRelatedReports = false) {
    const stores = deleteRelatedReports ? ['packs', 'files', 'reports'] : ['packs', 'files'];
    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore('packs').delete(packId);
    await deleteByIndex(tx.objectStore('files'), 'packId', packId);
    if (deleteRelatedReports) await deleteByIndex(tx.objectStore('reports'), 'packId', packId);
    await transactionDone(tx);
  }

  function isSafePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 240 &&
      !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..');
  }

  async function sha256Hex(bytesOrBlob) {
    const buffer = bytesOrBlob instanceof Blob
      ? await bytesOrBlob.arrayBuffer()
      : bytesOrBlob instanceof Uint8Array
        ? bytesOrBlob.buffer.slice(bytesOrBlob.byteOffset, bytesOrBlob.byteOffset + bytesOrBlob.byteLength)
        : bytesOrBlob;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function decodePackText(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const gzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!gzip) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!('DecompressionStream' in window)) throw new Error('このブラウザはGZIP展開に非対応です。非圧縮版を使用してください。');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  function validateFeatureCollection(value, path) {
    if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
      throw new Error(`${path} はGeoJSON FeatureCollectionではありません。`);
    }
  }

  async function parseAndVerifyPack(arrayBuffer, sourceName) {
    updateProgress(`${sourceName}を展開しています…`, 10);
    const container = JSON.parse(await decodePackText(arrayBuffer));
    if (container.format !== 'disaster-map-pack-container' || container.formatVersion !== 1) throw new Error('未対応の地域パック形式です。');
    const manifest = container.manifest;
    if (!manifest || manifest.format !== 'disaster-map-pack' || manifest.formatVersion !== 1) throw new Error('manifest形式が不正です。');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(manifest.id || '')) throw new Error('manifest.idが不正です。');
    if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('manifest.filesが空です。');

    const verifiedFiles = [];
    let totalBytes = 0;
    for (let i = 0; i < manifest.files.length; i += 1) {
      const definition = manifest.files[i];
      if (!isSafePath(definition.path)) throw new Error(`不正なファイルパス: ${definition.path}`);
      const payload = container.files?.[definition.path];
      if (!payload || typeof payload.data !== 'string') throw new Error(`ファイルがありません: ${definition.path}`);
      const bytes = payload.encoding === 'utf8'
        ? new TextEncoder().encode(payload.data)
        : payload.encoding === 'base64'
          ? base64ToBytes(payload.data)
          : null;
      if (!bytes) throw new Error(`未対応エンコード: ${definition.path}`);
      const hash = await sha256Hex(bytes);
      if (String(definition.sha256 || '').toLowerCase() !== hash) throw new Error(`SHA-256不一致: ${definition.path}`);
      if (Number(definition.bytes) !== bytes.byteLength) throw new Error(`サイズ不一致: ${definition.path}`);
      if (String(definition.mediaType || '').includes('geo+json')) validateFeatureCollection(JSON.parse(new TextDecoder().decode(bytes)), definition.path);
      verifiedFiles.push({
        key: `${manifest.id}::${definition.path}`,
        packId: manifest.id,
        path: definition.path,
        role: definition.role || 'other',
        mediaType: definition.mediaType || 'application/octet-stream',
        bytes: bytes.byteLength,
        sha256: hash,
        blob: new Blob([bytes], { type: definition.mediaType || 'application/octet-stream' })
      });
      totalBytes += bytes.byteLength;
      updateProgress(`整合性検証 ${i + 1}/${manifest.files.length}`, 20 + Math.round(((i + 1) / manifest.files.length) * 60));
    }
    return { manifest, verifiedFiles, totalBytes };
  }

  async function storePack(parsed) {
    if (await dbGet('packs', parsed.manifest.id)) await deletePackData(parsed.manifest.id, false);
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
    const files = tx.objectStore('files');
    parsed.verifiedFiles.forEach((file) => files.put(file));
    await transactionDone(tx);
  }

  async function installPackBuffer(arrayBuffer, sourceName) {
    showProgress('地域パック導入', `${sourceName}を読み込んでいます…`, 5);
    try {
      const parsed = await parseAndVerifyPack(arrayBuffer, sourceName);
      const existing = await dbGet('packs', parsed.manifest.id);
      if (existing && !confirm(`「${parsed.manifest.name}」を上書きしますか？`)) return false;
      updateProgress('端末へ保存しています…', 90);
      await storePack(parsed);
      await refreshPackSelect(parsed.manifest.id);
      await activatePack(parsed.manifest.id, true);
      await refreshStorageSummary();
      toast(`「${parsed.manifest.name}」を導入しました。`, 'success');
      return true;
    } finally {
      hideProgress();
    }
  }

  async function installPackFromUrl(url, name) {
    const absolute = new URL(url, location.href).href;
    showProgress('地域パック取得', `${name || absolute}をダウンロードしています…`, null);
    try {
      const response = await fetch(absolute, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      hideProgress();
      return installPackBuffer(buffer, name || absolute);
    } catch (error) {
      hideProgress();
      throw error;
    }
  }

  async function readRole(packId, manifest, role) {
    const merged = featureCollection();
    for (const definition of manifest.files.filter((item) => item.role === role)) {
      const record = await dbGet('files', `${packId}::${definition.path}`);
      if (!record) throw new Error(`保存ファイル欠落: ${definition.path}`);
      const json = JSON.parse(await record.blob.text());
      validateFeatureCollection(json, definition.path);
      merged.features.push(...json.features);
    }
    return merged;
  }

  async function loadPackDataset(pack) {
    const data = emptyDataset();
    for (const role of Object.keys(data)) data[role] = await readRole(pack.id, pack.manifest, role);
    return data;
  }

  function normalizeBearing(value) {
    let result = Number(value || 0) % 360;
    if (result < 0) result += 360;
    return result;
  }

  function rotateVector(x, y, radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    return [x * c - y * s, x * s + y * c];
  }

  class MapRenderer {
    constructor(canvas, popup) {
      this.canvas = canvas;
      this.popup = popup;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.center = [...DEFAULT_VIEW.center];
      this.zoom = DEFAULT_VIEW.zoom;
      this.pitch = DEFAULT_VIEW.pitch;
      this.bearing = DEFAULT_VIEW.bearing;
      this.comparison = 0.65;
      this.data = emptyDataset();
      this.reports = [];
      this.currentLocation = null;
      this.satelliteLayers = [];
      this.satelliteOpacity = 0.65;
      this.osmEnabled = true;
      this.tileCache = new Map();
      this.hitFeatures = [];
      this.selectedFeatureId = null;
      this.gesture = null;
      this.layers = { basemap: true, buildings: true, hazards: true, routes: true, shelters: true, weather: true, reports: true };
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement);
      this.bindEvents();
      this.resize();
    }

    bindEvents() {
      this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      this.canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 && event.button !== 2) return;
        event.preventDefault();
        this.canvas.setPointerCapture(event.pointerId);
        this.gesture = {
          id: event.pointerId,
          mode: event.button === 2 || event.shiftKey ? 'rotate' : 'pan',
          startX: event.clientX,
          startY: event.clientY,
          startCenter: this.lngLatToWorld(this.center[0], this.center[1]),
          startBearing: this.bearing,
          startPitch: this.pitch,
          moved: false
        };
        this.hidePopup();
      });
      this.canvas.addEventListener('pointermove', (event) => {
        if (!this.gesture || event.pointerId !== this.gesture.id) return;
        event.preventDefault();
        const dx = event.clientX - this.gesture.startX;
        const dy = event.clientY - this.gesture.startY;
        if (Math.hypot(dx, dy) > 4) this.gesture.moved = true;
        if (this.gesture.mode === 'rotate') {
          this.bearing = normalizeBearing(this.gesture.startBearing + dx * 0.35);
          this.pitch = Math.max(0, Math.min(65, this.gesture.startPitch - dy * 0.28));
        } else {
          const [ux, uy] = rotateVector(dx, dy, this.bearing * Math.PI / 180);
          const scale = this.worldSize();
          const pitchFactor = Math.max(0.25, Math.cos(this.pitchRadians()));
          this.center = this.worldToLngLat(
            this.gesture.startCenter.x - ux / scale,
            Math.max(0.001, Math.min(0.999, this.gesture.startCenter.y - uy / (scale * pitchFactor)))
          );
        }
        this.render();
      });
      const finish = (event) => {
        if (!this.gesture || event.pointerId !== this.gesture.id) return;
        const moved = this.gesture.moved;
        this.gesture = null;
        if (!moved && event.button === 0) this.handleClick(event.offsetX, event.offsetY);
        this.emitViewChanged();
      };
      this.canvas.addEventListener('pointerup', finish);
      this.canvas.addEventListener('pointercancel', finish);
      this.canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        this.setZoom(this.zoom + (event.deltaY < 0 ? 0.55 : -0.55));
      }, { passive: false });
      this.canvas.addEventListener('dblclick', (event) => {
        event.preventDefault();
        this.setZoom(this.zoom + 1);
      });
      this.canvas.addEventListener('keydown', (event) => {
        if (event.key === '+' || event.key === '=') this.setZoom(this.zoom + 0.5);
        else if (event.key === '-') this.setZoom(this.zoom - 0.5);
        else return;
        event.preventDefault();
      });
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, 2);
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

    getView() { return { center: [...this.center], zoom: this.zoom, pitch: this.pitch, bearing: this.bearing }; }
    setView(view, notify = true) {
      if (Array.isArray(view?.center)) this.center = [Number(view.center[0]), Number(view.center[1])];
      if (Number.isFinite(Number(view?.zoom))) this.zoom = Math.max(2, Math.min(21, Number(view.zoom)));
      if (Number.isFinite(Number(view?.pitch))) this.pitch = Math.max(0, Math.min(65, Number(view.pitch)));
      if (Number.isFinite(Number(view?.bearing))) this.bearing = normalizeBearing(view.bearing);
      this.render();
      if (notify) this.emitViewChanged();
    }
    setZoom(value) { this.zoom = Math.max(2, Math.min(21, Number(value))); this.render(); this.emitViewChanged(); }
    setBearing(value) { this.bearing = normalizeBearing(value); this.render(); this.emitViewChanged(); }
    toggle3D() { this.pitch = this.pitch > 5 ? 0 : 52; this.render(); this.emitViewChanged(); return this.pitch > 5; }
    setLayer(name, visible) { this.layers[name] = Boolean(visible); this.render(); }
    setComparison(value) { this.comparison = Math.max(0, Math.min(1, Number(value))); this.render(); }
    setData(data, reportList) { this.data = data || emptyDataset(); this.reports = reportList || []; this.render(); }
    setReports(value) { this.reports = value || []; this.render(); }
    setCurrentLocation(value) { this.currentLocation = value; this.render(); }
    setSelectedFeature(value) { this.selectedFeatureId = value || null; this.render(); }
    setOsmEnabled(value) { this.osmEnabled = Boolean(value); this.render(); updateAttribution(); }
    setSatelliteLayers(value) { this.satelliteLayers = value || []; this.render(); updateAttribution(); }

    emitViewChanged() {
      clearTimeout(persistViewTimer);
      persistViewTimer = setTimeout(() => {
        if (activePack) setSetting(`view:${activePack.id}`, this.getView()).catch(console.error);
      }, 400);
    }

    lngLatToWorld(lng, lat) {
      const clamped = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
      const sin = Math.sin(clamped * Math.PI / 180);
      return { x: (Number(lng) + 180) / 360, y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
    }
    worldToLngLat(x, y) {
      const lng = x * 360 - 180;
      const n = Math.PI - 2 * Math.PI * y;
      return [lng, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
    }
    worldSize() { return 512 * (2 ** this.zoom); }
    pitchRadians() { return this.pitch * Math.PI / 180; }
    projectWorld(worldX, worldY) {
      const centerWorld = this.lngLatToWorld(this.center[0], this.center[1]);
      let dx = worldX - centerWorld.x;
      if (dx > 0.5) dx -= 1;
      if (dx < -0.5) dx += 1;
      const dy = worldY - centerWorld.y;
      const scale = this.worldSize();
      const [rx, ry] = rotateVector(dx * scale, dy * scale * Math.max(0.25, Math.cos(this.pitchRadians())), -this.bearing * Math.PI / 180);
      return [this.width / 2 + rx, this.height / 2 + ry];
    }
    project(coord) { const world = this.lngLatToWorld(coord[0], coord[1]); return this.projectWorld(world.x, world.y); }
    heightPixels(meters, latitude = this.center[1]) {
      if (this.pitch <= 1) return 0;
      const pxPerMeter = this.worldSize() / (40075016.686 * Math.max(0.15, Math.cos(latitude * Math.PI / 180)));
      return Math.max(1, Number(meters || 6) * pxPerMeter * Math.sin(this.pitchRadians()));
    }

    fitBounds(bounds) {
      if (!Array.isArray(bounds) || bounds.length !== 4) return;
      const [west, south, east, north] = bounds.map(Number);
      const a = this.lngLatToWorld(west, north);
      const b = this.lngLatToWorld(east, south);
      const dx = Math.max(Math.abs(b.x - a.x), 1e-9);
      const dy = Math.max(Math.abs(b.y - a.y), 1e-9);
      const usableW = Math.max(100, this.width - 100);
      const usableH = Math.max(100, this.height - 100);
      const pitchFactor = Math.max(0.3, Math.cos(this.pitchRadians()));
      this.center = [(west + east) / 2, (south + north) / 2];
      this.zoom = Math.max(2, Math.min(21, Math.min(Math.log2(usableW / (512 * dx)), Math.log2(usableH / (512 * dy * pitchFactor)))));
      this.render();
      this.emitViewChanged();
    }
    flyTo(coord, zoom = null) { this.center = [Number(coord[0]), Number(coord[1])]; if (zoom !== null) this.zoom = Math.max(2, Math.min(21, Number(zoom))); this.render(); this.emitViewChanged(); }

    render() {
      if (!this.ctx || !this.width || !this.height) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#dce4e8';
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawOsm();
      this.drawSatellite();
      this.drawGrid();
      this.hitFeatures = [];
      if (this.layers.basemap) this.drawBasemap();
      if (this.layers.hazards) this.drawHazards();
      if (this.layers.buildings) this.drawBuildings();
      if (this.layers.routes) this.drawRoutes();
      if (this.layers.shelters) this.drawPoints(this.data.shelters.features, 'shelter');
      if (this.layers.weather) this.drawPoints(this.data.weather.features, 'weather');
      if (this.layers.reports) this.drawReports();
      if (this.currentLocation) this.drawCurrentLocation();
      ctx.restore();
      this.updateScale();
      updateBearingBadge();
    }

    getTile(z, x, y) {
      const count = 2 ** z;
      const wrappedX = ((x % count) + count) % count;
      const key = `${z}/${wrappedX}/${y}`;
      let record = this.tileCache.get(key);
      if (record) { record.used = Date.now(); return record; }
      const image = new Image();
      image.decoding = 'async';
      record = { image, state: 'loading', used: Date.now() };
      this.tileCache.set(key, record);
      image.onload = () => { record.state = 'ready'; this.render(); };
      image.onerror = () => { record.state = 'error'; };
      image.src = `https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`;
      return record;
    }

    drawOsm() {
      if (!this.osmEnabled || !navigator.onLine) return;
      const z = Math.max(1, Math.min(19, Math.floor(this.zoom)));
      const count = 2 ** z;
      const center = this.lngLatToWorld(this.center[0], this.center[1]);
      const radiusPx = Math.hypot(this.width, this.height) * 0.8 + 420;
      const radiusWorld = radiusPx / this.worldSize() / Math.max(0.25, Math.cos(this.pitchRadians()));
      const minX = Math.floor((center.x - radiusWorld) * count) - 1;
      const maxX = Math.floor((center.x + radiusWorld) * count) + 1;
      const minY = Math.max(0, Math.floor((center.y - radiusWorld) * count) - 1);
      const maxY = Math.min(count - 1, Math.floor((center.y + radiusWorld) * count) + 1);
      let tiles = 0;
      for (let y = minY; y <= maxY && tiles < 220; y += 1) {
        for (let x = minX; x <= maxX && tiles < 220; x += 1) {
          const record = this.getTile(z, x, y);
          if (record.state !== 'ready') continue;
          const tl = this.projectWorld(x / count, y / count);
          const tr = this.projectWorld((x + 1) / count, y / count);
          const bl = this.projectWorld(x / count, (y + 1) / count);
          this.ctx.save();
          this.ctx.globalAlpha = 0.96;
          this.ctx.transform((tr[0] - tl[0]) / 256, (tr[1] - tl[1]) / 256, (bl[0] - tl[0]) / 256, (bl[1] - tl[1]) / 256, tl[0], tl[1]);
          this.ctx.drawImage(record.image, 0, 0, 256, 256);
          this.ctx.restore();
          tiles += 1;
        }
      }
      if (this.tileCache.size > 340) {
        [...this.tileCache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.tileCache.size - 280).forEach(([key]) => this.tileCache.delete(key));
      }
    }

    drawSatellite() {
      this.satelliteLayers.forEach((layer) => {
        if (!layer.image || !Array.isArray(layer.bounds)) return;
        const [west, south, east, north] = layer.bounds.map(Number);
        const tl = this.project([west, north]);
        const tr = this.project([east, north]);
        const bl = this.project([west, south]);
        const w = layer.image.naturalWidth || layer.image.width;
        const h = layer.image.naturalHeight || layer.image.height;
        if (!w || !h) return;
        this.ctx.save();
        this.ctx.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity ?? this.satelliteOpacity)));
        this.ctx.transform((tr[0] - tl[0]) / w, (tr[1] - tl[1]) / w, (bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h, tl[0], tl[1]);
        this.ctx.drawImage(layer.image, 0, 0, w, h);
        this.ctx.restore();
      });
    }

    drawGrid() {
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(70, 88, 100, .12)';
      this.ctx.lineWidth = 1;
      for (let x = 0; x < this.width; x += 80) { this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, this.height); this.ctx.stroke(); }
      for (let y = 0; y < this.height; y += 80) { this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(this.width, y); this.ctx.stroke(); }
      this.ctx.restore();
    }

    geometryParts(geometry) { if (!geometry) return []; if (geometry.type === 'Polygon') return [geometry.coordinates]; if (geometry.type === 'MultiPolygon') return geometry.coordinates; return []; }
    lineParts(geometry) { if (!geometry) return []; if (geometry.type === 'LineString') return [geometry.coordinates]; if (geometry.type === 'MultiLineString') return geometry.coordinates; return []; }
    drawPath(rings, offsetY = 0) {
      this.ctx.beginPath();
      rings.forEach((ring) => {
        ring.forEach((coord, i) => { const [x, y] = this.project(coord); if (i === 0) this.ctx.moveTo(x, y - offsetY); else this.ctx.lineTo(x, y - offsetY); });
        this.ctx.closePath();
      });
    }
    drawLine(coords, color, width, casing = null, dash = []) {
      const draw = (stroke, lineWidth) => {
        this.ctx.beginPath();
        coords.forEach((coord, i) => { const p = this.project(coord); if (i === 0) this.ctx.moveTo(p[0], p[1]); else this.ctx.lineTo(p[0], p[1]); });
        this.ctx.strokeStyle = stroke; this.ctx.lineWidth = lineWidth; this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round'; this.ctx.setLineDash(dash); this.ctx.stroke(); this.ctx.setLineDash([]);
      };
      if (casing) draw(casing, width + 2);
      draw(color, width);
    }

    drawBasemap() {
      this.data.basemap.features.forEach((feature) => {
        const kind = feature.properties?.kind || 'land';
        if (['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
          const fill = kind === 'water' ? '#9bc7dd' : kind === 'park' ? '#b7d1ad' : '#d8ded9';
          this.geometryParts(feature.geometry).forEach((rings) => { this.drawPath(rings); this.ctx.fillStyle = fill; this.ctx.fill('evenodd'); this.ctx.strokeStyle = 'rgba(70,90,100,.4)'; this.ctx.stroke(); });
        } else {
          const color = kind === 'river' ? '#4d91b5' : '#f6f2e9';
          this.lineParts(feature.geometry).forEach((line) => this.drawLine(line, color, Number(feature.properties?.width || 3), '#6e7880'));
        }
      });
    }

    drawHazards() {
      const opacity = 0.1 + this.comparison * 0.45;
      this.data.hazards.features.forEach((feature) => {
        const type = feature.properties?.hazard_type || 'change';
        const fill = type === 'flood' ? `rgba(49,124,192,${opacity})` : type === 'landslide' ? `rgba(166,104,41,${opacity})` : `rgba(221,65,55,${opacity})`;
        this.geometryParts(feature.geometry).forEach((rings) => { this.drawPath(rings); this.ctx.fillStyle = fill; this.ctx.fill('evenodd'); this.ctx.strokeStyle = type === 'flood' ? '#317cc0' : '#b8312b'; this.ctx.lineWidth = 2; this.ctx.setLineDash([7,5]); this.ctx.stroke(); this.ctx.setLineDash([]); });
      });
    }

    buildingColor(properties) {
      const damage = Math.max(0, Math.min(1, Number(properties.damage_score || 0)));
      if (properties.confirmed_status === 'safe') return '#3ba776';
      if (properties.confirmed_status === 'destroyed') return '#8f1d1d';
      const r = Math.round(137 + (216 - 137) * damage * this.comparison);
      const g = Math.round(153 + (68 - 153) * damage * this.comparison);
      const b = Math.round(164 + (63 - 164) * damage * this.comparison);
      return `rgb(${r},${g},${b})`;
    }

    drawBuildings() {
      const entries = [];
      this.data.buildings.features.forEach((feature) => this.geometryParts(feature.geometry).forEach((rings) => {
        if (!rings[0]?.length) return;
        const ground = rings[0].map((coord) => this.project(coord));
        entries.push({ feature, rings, ground, y: ground.reduce((s, p) => s + p[1], 0) / ground.length });
      }));
      entries.sort((a, b) => a.y - b.y);
      entries.forEach(({ feature, rings, ground }) => {
        const props = feature.properties || {};
        const height = this.heightPixels(props.height || (props.levels || 2) * 3, rings[0][0][1]);
        const color = this.buildingColor(props);
        if (height > 0.5) {
          for (let i = 0; i < ground.length - 1; i += 1) {
            const a = ground[i], b = ground[i + 1];
            this.ctx.beginPath(); this.ctx.moveTo(a[0], a[1]); this.ctx.lineTo(b[0], b[1]); this.ctx.lineTo(b[0], b[1] - height); this.ctx.lineTo(a[0], a[1] - height); this.ctx.closePath(); this.ctx.fillStyle = '#52636d'; this.ctx.globalAlpha = 0.82; this.ctx.fill(); this.ctx.globalAlpha = 1;
          }
        }
        this.drawPath(rings, height); this.ctx.fillStyle = color; this.ctx.fill('evenodd'); this.ctx.strokeStyle = String(props.id || feature.id) === String(this.selectedFeatureId) ? '#ffef6a' : '#475963'; this.ctx.lineWidth = String(props.id || feature.id) === String(this.selectedFeatureId) ? 3 : 1; this.ctx.stroke();
        this.hitFeatures.push({ feature, polygon: ground.map(([x, y]) => [x, y - height]) });
      });
    }

    drawRoutes() {
      this.data.routes.features.forEach((feature) => {
        const status = feature.properties?.status || 'open';
        const color = status === 'blocked' ? '#c42f2f' : status === 'restricted' ? '#d58a25' : '#278b61';
        this.lineParts(feature.geometry).forEach((line) => this.drawLine(line, color, 5, '#f5f7f8', status === 'blocked' ? [9,5] : []));
      });
    }

    drawPoints(features, type) {
      features.forEach((feature) => {
        if (feature.geometry?.type !== 'Point') return;
        const [x, y] = this.project(feature.geometry.coordinates);
        this.ctx.beginPath(); this.ctx.arc(x, y, type === 'shelter' ? 8 : 7, 0, Math.PI * 2); this.ctx.fillStyle = type === 'shelter' ? '#276fb3' : '#7b4db0'; this.ctx.fill(); this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 2; this.ctx.stroke();
        const props = feature.properties || {};
        this.ctx.fillStyle = '#17242d'; this.ctx.font = 'bold 11px system-ui'; this.ctx.textAlign = 'left'; this.ctx.fillText(String(props.name || props.summary || type), x + 11, y + 4);
        this.hitFeatures.push({ feature, point: [x, y], radius: 13 });
      });
    }

    drawReports() {
      this.reports.forEach((report) => {
        const [x, y] = this.project([report.longitude, report.latitude]);
        this.ctx.save(); this.ctx.translate(x, y); this.ctx.rotate(Math.PI / 4); this.ctx.fillStyle = report.status === 'resolved' ? '#36865f' : report.category === 'rescue' ? '#b2284a' : '#e5822d'; this.ctx.fillRect(-6,-6,12,12); this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 2; this.ctx.strokeRect(-6,-6,12,12); this.ctx.restore();
        this.hitFeatures.push({ report, point: [x,y], radius: 13 });
      });
    }

    drawCurrentLocation() {
      const [x, y] = this.project([this.currentLocation.longitude, this.currentLocation.latitude]);
      this.ctx.beginPath(); this.ctx.arc(x, y, 8, 0, Math.PI * 2); this.ctx.fillStyle = '#1e73be'; this.ctx.fill(); this.ctx.strokeStyle = '#fff'; this.ctx.lineWidth = 2; this.ctx.stroke();
    }

    pointInPolygon(point, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const xi = polygon[i][0], yi = polygon[i][1], xj = polygon[j][0], yj = polygon[j][1];
        if (((yi > point[1]) !== (yj > point[1])) && point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 1e-12) + xi) inside = !inside;
      }
      return inside;
    }

    handleClick(x, y) {
      for (let i = this.hitFeatures.length - 1; i >= 0; i -= 1) {
        const hit = this.hitFeatures[i];
        if (hit.polygon && this.pointInPolygon([x,y], hit.polygon)) return this.showFeature(hit.feature, x, y);
        if (hit.point && Math.hypot(hit.point[0] - x, hit.point[1] - y) <= hit.radius) return hit.report ? this.showReport(hit.report, x, y) : this.showFeature(hit.feature, x, y);
      }
      this.selectedFeatureId = null; this.hidePopup(); this.render();
    }

    popupAt(x, y, title, rows) {
      this.popup.replaceChildren();
      const strong = document.createElement('strong'); strong.textContent = title;
      this.popup.appendChild(strong);
      rows.filter((row) => row[1] !== undefined && row[1] !== null && row[1] !== '').forEach(([label, value]) => { const div = document.createElement('div'); div.textContent = `${label}: ${value}`; this.popup.appendChild(div); });
      this.popup.style.left = `${Math.max(8, Math.min(this.width - 330, x + 12))}px`;
      this.popup.style.top = `${Math.max(8, Math.min(this.height - 240, y + 12))}px`;
      this.popup.hidden = false;
    }
    showFeature(feature, x, y) {
      const p = feature.properties || {};
      this.selectedFeatureId = p.id || feature.id || null;
      this.render();
      this.popupAt(x, y, p.name || p.summary || p.id || '地点', [['ID', p.id || feature.id], ['住所', p.address], ['種別', p.facility_type || p.kind], ['対応災害', p.hazards_text], ['状態', p.confirmed_status], ['変化指標', p.damage_score]]);
    }
    showReport(report, x, y) { this.popupAt(x, y, '現地調査記録', [['種別', report.category], ['状態', report.status], ['メモ', report.note], ['更新', formatDate(report.updatedAt)]]); }
    hidePopup() { this.popup.hidden = true; }

    updateScale() {
      const metersPerPixel = 40075016.686 * Math.cos(this.center[1] * Math.PI / 180) / this.worldSize();
      const target = metersPerPixel * 120;
      const power = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
      const normalized = target / power;
      const nice = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
      const distance = nice * power;
      const label = distance >= 1000 ? `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)} km` : `${Math.round(distance)} m`;
      dom.mapScale.textContent = `${label} / Zoom ${this.zoom.toFixed(1)}`;
    }
  }

  const renderer = new MapRenderer(dom.mapCanvas, dom.mapPopup);

  function updateBearingBadge() {
    dom.bearingBadge.textContent = `方位 ${Math.round(normalizeBearing(renderer.bearing))}°`;
    dom.toggle3dButton.textContent = renderer.pitch > 5 ? '2D' : '3D';
  }

  function boundsIntersect(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return true;
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  }

  async function imageFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('衛星画像を読めません。')); image.src = url; });
    image.__url = url;
    return image;
  }

  async function refreshSatelliteLayers() {
    const records = await dbGetAll('layers');
    const bounds = activePack?.manifest?.bounds || null;
    const visible = records.filter((item) => boundsIntersect(item.bounds, bounds));
    renderer.satelliteLayers.forEach((layer) => { if (layer.image?.__url) URL.revokeObjectURL(layer.image.__url); });
    const layers = [];
    for (const record of visible) layers.push({ ...record, image: await imageFromBlob(record.blob), opacity: record.opacity ?? renderer.satelliteOpacity });
    renderer.setSatelliteLayers(layers);
    dom.alos2Info.textContent = layers.length ? `${layers.length}件のALOS-2レイヤーを表示中` : 'この地域に保存済みのALOS-2レイヤーはありません。';
  }

  async function loadRegionCatalog() {
    const response = await fetch('./data/catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`地域カタログ HTTP ${response.status}`);
    const json = await response.json();
    regionCatalog = Array.isArray(json.packs) ? json.packs : [];
    dom.catalogSelect.replaceChildren();
    regionCatalog.forEach((entry) => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name; dom.catalogSelect.appendChild(option); });
  }

  async function loadAlosCatalog() {
    const response = await fetch('./data/alos2/catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`ALOS-2カタログ HTTP ${response.status}`);
    alosCatalog = await response.json();
    const products = Array.isArray(alosCatalog.products) ? alosCatalog.products : [];
    dom.alos2ProductSelect.replaceChildren();
    if (!products.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = '表示用レイヤーは未登録'; dom.alos2ProductSelect.appendChild(option);
      dom.installAlos2Button.textContent = 'ALOS-2公開状況を確認';
    } else {
      products.forEach((product) => { const option = document.createElement('option'); option.value = product.id; option.textContent = `${product.name}${product.observedAt ? ` / ${product.observedAt}` : ''}`; dom.alos2ProductSelect.appendChild(option); });
      dom.installAlos2Button.textContent = 'ALOS-2データを取得';
    }
  }

  async function installSelectedRegion() {
    const entry = regionCatalog.find((item) => item.id === dom.catalogSelect.value);
    if (!entry) throw new Error('地域を選択してください。');
    try {
      await installPackFromUrl(entry.url, entry.name);
    } catch (error) {
      if (entry.fallbackUrl && String(error.message).includes('GZIP')) await installPackFromUrl(entry.fallbackUrl, `${entry.name}（非圧縮）`);
      else throw error;
    }
  }

  async function installSelectedAlos() {
    const products = Array.isArray(alosCatalog.products) ? alosCatalog.products : [];
    if (!products.length) {
      if (alosCatalog.officialIndexUrl) window.open(alosCatalog.officialIndexUrl, '_blank', 'noopener,noreferrer');
      dom.alos2Info.textContent = 'JAXA公式公開ページを開きました。熊本県嘉島町を含む対応レイヤーは、公開・軽量変換後にカタログへ追加されます。';
      return;
    }
    const product = products.find((item) => item.id === dom.alos2ProductSelect.value);
    if (!product) throw new Error('ALOS-2プロダクトを選択してください。');
    if (activePack?.manifest?.bounds && product.bounds && !boundsIntersect(activePack.manifest.bounds, product.bounds)) throw new Error('現在の地域パック範囲と重なりません。');
    if (!product.imageUrl) {
      if (product.sourceUrl) window.open(product.sourceUrl, '_blank', 'noopener,noreferrer');
      throw new Error('原データのみ公開済みで、Web表示用レイヤーは未生成です。');
    }
    showProgress('ALOS-2取得', `${product.name}をダウンロードしています…`, null);
    try {
      const response = await fetch(product.imageUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (product.sha256 && (await sha256Hex(blob)).toLowerCase() !== String(product.sha256).toLowerCase()) throw new Error('SHA-256不一致');
      await dbPut('layers', { id: product.id, name: product.name, bounds: product.bounds, opacity: product.opacity ?? 0.65, observedAt: product.observedAt || null, attribution: product.attribution || 'JAXA ALOS-2/PALSAR-2', sourceUrl: product.sourceUrl || null, downloadedAt: new Date().toISOString(), blob });
      await refreshSatelliteLayers();
      toast(`「${product.name}」を反映しました。`, 'success');
    } finally { hideProgress(); }
  }

  async function clearAlosLayers() {
    if (!confirm('保存済みALOS-2レイヤーをすべて削除しますか？')) return;
    await clearStores(['layers']);
    await refreshSatelliteLayers();
    toast('ALOS-2レイヤーを削除しました。', 'success');
  }

  async function refreshPackSelect(preferred = '') {
    const packs = (await dbGetAll('packs')).sort((a,b) => a.name.localeCompare(b.name, 'ja'));
    const desired = preferred || dom.packSelect.value || await getSetting('activePackId', '');
    dom.packSelect.replaceChildren();
    const none = document.createElement('option'); none.value = ''; none.textContent = '未選択'; dom.packSelect.appendChild(none);
    packs.forEach((pack) => { const option = document.createElement('option'); option.value = pack.id; option.textContent = `${pack.name} (${formatBytes(pack.totalBytes)})`; dom.packSelect.appendChild(option); });
    if (packs.some((pack) => pack.id === desired)) dom.packSelect.value = desired;
  }

  async function activatePack(packId, fitHome = false) {
    if (!packId) {
      activePack = null; activeData = emptyDataset(); reports = []; renderer.setData(activeData, reports); renderer.setView(DEFAULT_VIEW, false); dom.packBadge.textContent = '地域パック未選択'; dom.packDetails.textContent = '地域パックを選択してください。OpenStreetMapはオンライン時に表示できます。'; dom.deleteActivePackButton.disabled = true; dom.emptyMapMessage.hidden = true; await setSetting('activePackId', ''); await refreshSatelliteLayers(); renderReportList(); updateAttribution(); return;
    }
    showProgress('地域データ読込', '端末内データを読み込んでいます…', null);
    try {
      const pack = await dbGet('packs', packId);
      if (!pack) throw new Error('地域パックがありません。');
      activePack = pack;
      activeData = await loadPackDataset(pack);
      reports = await dbGetAllByIndex('reports', 'packId', packId);
      reports.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      renderer.setData(activeData, reports);
      const view = await getSetting(`view:${packId}`, null);
      if (view && !fitHome) renderer.setView(view, false);
      else if (Array.isArray(pack.manifest.bounds)) renderer.fitBounds(pack.manifest.bounds);
      else renderer.setView({ center: pack.manifest.center || [138,36], zoom: pack.manifest.zoom || 14, pitch: 0, bearing: 0 }, false);
      dom.packSelect.value = packId;
      dom.packBadge.textContent = pack.name;
      dom.packDetails.replaceChildren();
      [pack.description, `更新: ${formatDate(pack.manifest.dataUpdatedAt)}`, `容量: ${formatBytes(pack.totalBytes)}`, pack.manifest.disclaimer].filter(Boolean).forEach((text) => { const div = document.createElement('div'); div.textContent = text; dom.packDetails.appendChild(div); });
      dom.deleteActivePackButton.disabled = false;
      dom.emptyMapMessage.hidden = true;
      await setSetting('activePackId', packId);
      await refreshSatelliteLayers();
      renderReportList();
      updateAttribution();
    } finally { hideProgress(); }
  }

  function updateAttribution() {
    const credits = ['本アプリ：災観 SAIKAN'];
    if (renderer.osmEnabled) credits.push(OSM_ATTRIBUTION);
    (activePack?.manifest?.attributions || []).forEach((item) => credits.push(typeof item === 'string' ? item : item.text));
    if (renderer.satelliteLayers.length) credits.push('衛星：JAXA ALOS-2/PALSAR-2（表示用加工）');
    dom.attributionText.textContent = credits.filter(Boolean).join(' | ');
  }

  function updateNetworkStatus() {
    const online = navigator.onLine;
    dom.networkBadge.textContent = online ? 'オンライン' : 'オフライン';
    dom.networkBadge.classList.toggle('badge-muted', !online);
    dom.staleBanner.hidden = online;
    if (!online) dom.staleText.textContent = `保存済みデータのみ表示中${activePack ? ` / 更新 ${formatDate(activePack.manifest.dataUpdatedAt)}` : ''}`;
    renderer.render();
  }

  function featureCenter(feature) {
    const g = feature.geometry;
    if (!g) return null;
    if (g.type === 'Point') return g.coordinates;
    let coords = [];
    if (g.type === 'Polygon') coords = g.coordinates[0] || [];
    else if (g.type === 'MultiPolygon') coords = g.coordinates[0]?.[0] || [];
    else if (g.type === 'LineString') coords = g.coordinates;
    if (!coords.length) return null;
    return [coords.reduce((s,c) => s + Number(c[0]), 0) / coords.length, coords.reduce((s,c) => s + Number(c[1]), 0) / coords.length];
  }

  function runSearch() {
    const term = dom.searchInput.value.trim().toLocaleLowerCase('ja');
    if (!term) return dom.searchResults.textContent = '施設名・住所・IDを入力してください。';
    const features = [...activeData.buildings.features, ...activeData.shelters.features, ...activeData.weather.features].filter((feature) => {
      const p = feature.properties || {};
      return [p.id, p.name, p.address, p.facility_type, feature.id].filter(Boolean).some((v) => String(v).toLocaleLowerCase('ja').includes(term));
    });
    dom.searchResults.replaceChildren();
    if (!features.length) return dom.searchResults.textContent = '該当する地点はありません。';
    features.slice(0,30).forEach((feature) => {
      const p = feature.properties || {};
      const item = document.createElement('div'); item.className = 'result-item';
      const title = document.createElement('strong'); title.textContent = p.name || p.id || '名称なし';
      const meta = document.createElement('div'); meta.textContent = p.address || p.facility_type || `ID: ${p.id || feature.id || '不明'}`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '地図で表示'; button.addEventListener('click', () => { const center = featureCenter(feature); if (center) renderer.flyTo(center, Math.max(renderer.zoom, 16)); renderer.setSelectedFeature(p.id || feature.id); });
      item.append(title, meta, button); dom.searchResults.appendChild(item);
    });
  }

  function renderReportList() {
    dom.reportList.replaceChildren();
    if (!activePack) return dom.reportList.textContent = '地域パックを選択してください。';
    if (!reports.length) return dom.reportList.textContent = '調査記録はありません。';
    reports.slice(0,30).forEach((report) => {
      const item = document.createElement('div'); item.className = 'report-item';
      const title = document.createElement('strong'); title.textContent = `${report.category} / ${report.status}`;
      const note = document.createElement('div'); note.textContent = report.note || 'メモなし';
      const meta = document.createElement('div'); meta.textContent = `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)} / ${formatDate(report.updatedAt)}`;
      const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = '地図で表示'; locate.addEventListener('click', () => renderer.flyTo([report.longitude, report.latitude], 17));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger-outline'; remove.textContent = '削除'; remove.addEventListener('click', async () => { if (!confirm('削除しますか？')) return; await dbDelete('reports', report.id); reports = reports.filter((r) => r.id !== report.id); renderer.setReports(reports); renderReportList(); });
      item.append(title, note, meta, locate, remove); dom.reportList.appendChild(item);
    });
  }

  async function addReport() {
    if (!activePack) throw new Error('地域パックを選択してください。');
    let longitude, latitude, accuracy = null;
    if (dom.useCurrentLocation.checked) {
      if (!currentLocation) throw new Error('先に現在地を取得してください。');
      ({ longitude, latitude, accuracy } = currentLocation);
    } else [longitude, latitude] = renderer.center;
    const now = new Date().toISOString();
    const report = { id: crypto.randomUUID ? crypto.randomUUID() : `report-${Date.now()}`, packId: activePack.id, category: dom.reportCategory.value, status: dom.reportStatus.value, note: dom.reportNote.value.trim(), longitude, latitude, accuracy, createdAt: now, updatedAt: now, synced: false };
    await dbPut('reports', report); reports.unshift(report); renderer.setReports(reports); dom.reportNote.value = ''; renderReportList(); refreshStorageSummary(); toast('調査記録を保存しました。', 'success');
  }

  function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

  function exportReports() {
    if (!activePack) throw new Error('地域パックを選択してください。');
    const json = featureCollection(reports.map((r) => ({ type: 'Feature', id: r.id, geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }, properties: { ...r, longitude: undefined, latitude: undefined } })));
    downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/geo+json' }), `${activePack.id}-reports.geojson`);
  }

  async function importReports(file) {
    if (!activePack) throw new Error('地域パックを選択してください。');
    const json = JSON.parse(await file.text()); validateFeatureCollection(json, file.name);
    const tx = db.transaction('reports', 'readwrite');
    for (const feature of json.features) {
      if (feature.geometry?.type !== 'Point') continue;
      const p = feature.properties || {}; const now = new Date().toISOString();
      tx.objectStore('reports').put({ id: String(p.id || feature.id || crypto.randomUUID()), packId: activePack.id, category: p.category || 'other', status: p.status || 'open', note: String(p.note || ''), longitude: Number(feature.geometry.coordinates[0]), latitude: Number(feature.geometry.coordinates[1]), accuracy: p.accuracy ?? null, createdAt: p.createdAt || p.created_at || now, updatedAt: p.updatedAt || p.updated_at || now, synced: Boolean(p.synced) });
    }
    await transactionDone(tx); reports = await dbGetAllByIndex('reports', 'packId', activePack.id); renderer.setReports(reports); renderReportList(); toast('調査記録を読み込みました。', 'success');
  }

  async function locate() {
    if (!navigator.geolocation) throw new Error('位置情報APIに対応していません。');
    const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }));
    currentLocation = { longitude: pos.coords.longitude, latitude: pos.coords.latitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp };
    renderer.setCurrentLocation(currentLocation); renderer.flyTo([currentLocation.longitude, currentLocation.latitude], Math.max(renderer.zoom, 16)); toast(`現在地を取得しました（±${Math.round(currentLocation.accuracy)}m）`, 'success');
  }

  async function refreshStorageSummary() {
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    const packs = (await dbGetAll('packs')).length;
    const layerCount = (await dbGetAll('layers')).length;
    const reportCount = (await dbGetAll('reports')).length;
    dom.storageSummary.textContent = `使用量 ${estimate ? formatBytes(estimate.usage) : '不明'} / 上限 ${estimate ? formatBytes(estimate.quota) : '不明'} | 地域 ${packs}件 | ALOS-2 ${layerCount}件 | 記録 ${reportCount}件 | 永続保存 ${persistent ? '許可済み' : '未許可'}`;
  }

  async function requestPersistent() {
    if (!navigator.storage?.persist) throw new Error('永続保存要求に非対応です。');
    const accepted = await navigator.storage.persist(); await refreshStorageSummary(); toast(accepted ? '永続保存が許可されました。' : '永続保存は許可されませんでした。外部バックアップを保持してください。', accepted ? 'success' : 'error');
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('./sw.js', { scope: './' });
  }

  async function prepareOffline() {
    const results = [];
    showProgress('完全オフライン検証', 'アプリ本体をキャッシュしています…', null);
    try {
      const registration = await registerServiceWorker();
      await navigator.serviceWorker.ready;
      const worker = registration.active || navigator.serviceWorker.controller;
      if (worker) {
        await new Promise((resolve, reject) => {
          const channel = new MessageChannel(); const timer = setTimeout(() => reject(new Error('Service Worker応答なし')), 30000);
          channel.port1.onmessage = (event) => { clearTimeout(timer); event.data?.ok ? resolve() : reject(new Error(event.data?.error || 'キャッシュ失敗')); };
          worker.postMessage({ type: 'PRECACHE_ALL' }, [channel.port2]);
        });
        results.push({ status: 'ok', text: 'アプリ本体をキャッシュしました。' });
      }
      if (activePack) {
        for (const definition of activePack.manifest.files) {
          const record = await dbGet('files', `${activePack.id}::${definition.path}`);
          if (!record || await sha256Hex(record.blob) !== definition.sha256) throw new Error(`地域パック破損: ${definition.path}`);
        }
        results.push({ status: 'ok', text: '地域パックSHA-256検証に成功しました。' });
      } else results.push({ status: 'warn', text: '地域パック未選択です。' });
      results.push({ status: navigator.onLine ? 'warn' : 'ok', text: navigator.onLine ? '機内モードで再起動試験してください。' : '現在オフラインです。' });
      dom.offlineCheckResults.replaceChildren();
      results.forEach((r) => { const div = document.createElement('div'); div.className = `check-result ${r.status}`; div.textContent = `${r.status === 'ok' ? '✓' : '!'} ${r.text}`; dom.offlineCheckResults.appendChild(div); });
      toast('オフライン検証が完了しました。', 'success');
    } finally { hideProgress(); }
  }

  async function clearAppCaches() {
    if (!confirm('アプリ本体キャッシュを消去しますか？地域パックは保持します。')) return;
    const names = await caches.keys(); await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n))); toast('アプリキャッシュを消去しました。', 'success');
  }

  async function deleteActivePack() {
    if (!activePack || !confirm(`「${activePack.name}」と関連記録を削除しますか？`)) return;
    await deletePackData(activePack.id, true); await refreshPackSelect(''); await activatePack(''); await refreshStorageSummary(); toast('地域パックを削除しました。', 'success');
  }

  async function fullReset() {
    if (prompt('完全初期化する場合は RESET と入力してください。') !== 'RESET') return;
    db.close();
    await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(DB_NAME); request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('別タブを閉じてください。')); });
    const names = await caches.keys(); await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
    const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map((r) => r.unregister())); location.reload();
  }

  function bindEvents() {
    addEventListener('online', updateNetworkStatus); addEventListener('offline', updateNetworkStatus);
    dom.sidebarToggle.addEventListener('click', () => { const collapsed = dom.sidebar.classList.toggle('collapsed'); dom.workspace.classList.toggle('sidebar-collapsed', collapsed); dom.sidebarToggle.setAttribute('aria-expanded', String(!collapsed)); setTimeout(() => renderer.resize(), 50); });
    dom.installCatalogButton.addEventListener('click', () => installSelectedRegion().catch(handleError));
    dom.importPackButton.addEventListener('click', () => dom.packFileInput.click());
    dom.packFileInput.addEventListener('change', async () => { const file = dom.packFileInput.files?.[0]; dom.packFileInput.value = ''; if (file) try { await installPackBuffer(await file.arrayBuffer(), file.name); } catch (e) { handleError(e); } });
    dom.installUrlButton.addEventListener('click', () => { const url = dom.packUrlInput.value.trim(); if (url) installPackFromUrl(url, url).catch(handleError); });
    dom.packSelect.addEventListener('change', () => activatePack(dom.packSelect.value).catch(handleError));
    dom.deleteActivePackButton.addEventListener('click', () => deleteActivePack().catch(handleError));
    dom.installAlos2Button.addEventListener('click', () => installSelectedAlos().catch(handleError));
    dom.clearAlos2Button.addEventListener('click', () => clearAlosLayers().catch(handleError));
    dom.alos2Opacity.addEventListener('input', () => { renderer.satelliteOpacity = Number(dom.alos2Opacity.value) / 100; renderer.satelliteLayers.forEach((l) => { l.opacity = renderer.satelliteOpacity; }); renderer.render(); });
    dom.osmBasemap.addEventListener('change', () => renderer.setOsmEnabled(dom.osmBasemap.checked));
    document.querySelectorAll('[data-layer]').forEach((input) => input.addEventListener('change', () => renderer.setLayer(input.dataset.layer, input.checked)));
    dom.compareSlider.addEventListener('input', () => { const value = Number(dom.compareSlider.value); dom.compareValue.textContent = `${value}%`; renderer.setComparison(value / 100); });
    dom.searchButton.addEventListener('click', runSearch); dom.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
    dom.addReportButton.addEventListener('click', () => addReport().catch(handleError));
    dom.exportReportsButton.addEventListener('click', () => { try { exportReports(); } catch (e) { handleError(e); } });
    dom.importReportsButton.addEventListener('click', () => dom.reportFileInput.click());
    dom.reportFileInput.addEventListener('change', async () => { const file = dom.reportFileInput.files?.[0]; dom.reportFileInput.value = ''; if (file) try { await importReports(file); } catch (e) { handleError(e); } });
    dom.requestPersistButton.addEventListener('click', () => requestPersistent().catch(handleError));
    dom.prepareOfflineButton.addEventListener('click', () => prepareOffline().catch(handleError));
    dom.clearCacheButton.addEventListener('click', () => clearAppCaches().catch(handleError));
    dom.deleteReportsButton.addEventListener('click', async () => { if (confirm('全調査記録を削除しますか？')) { await clearStores(['reports']); reports = []; renderer.setReports([]); renderReportList(); } });
    dom.deleteAllPacksButton.addEventListener('click', async () => { if (confirm('全地域パックを削除しますか？')) { await clearStores(['packs','files']); await refreshPackSelect(''); await activatePack(''); } });
    dom.fullResetButton.addEventListener('click', () => fullReset().catch(handleError));
    dom.zoomInButton.addEventListener('click', () => renderer.setZoom(renderer.zoom + 0.7)); dom.zoomOutButton.addEventListener('click', () => renderer.setZoom(renderer.zoom - 0.7));
    dom.toggle3dButton.addEventListener('click', () => renderer.toggle3D()); dom.bearingResetButton.addEventListener('click', () => renderer.setBearing(0)); dom.locateButton.addEventListener('click', () => locate().catch(handleError));
    dom.homeViewButton.addEventListener('click', () => { if (activePack?.manifest?.bounds) renderer.fitBounds(activePack.manifest.bounds); else renderer.setView(DEFAULT_VIEW); });
  }

  function handleError(error) { console.error(error); hideProgress(); toast(error?.message || String(error), 'error', 8000); }

  async function init() {
    dom.versionBadge.textContent = `ver ${APP_VERSION}`;
    bindEvents();
    updateNetworkStatus();
    await registerServiceWorker().catch(console.warn);
    db = await openDatabase();
    await Promise.all([loadRegionCatalog(), loadAlosCatalog()]);
    await refreshPackSelect();
    const selected = dom.packSelect.value || await getSetting('activePackId', '');
    await activatePack(selected);
    await refreshStorageSummary();
    updateBearingBadge();
    renderer.render();
  }

  init().catch(handleError);
})();
