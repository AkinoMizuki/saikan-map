(() => {
  'use strict';

  const api = window.SAIKAN;
  if (!api?.renderer) {
    console.error('SAIKAN renderer API is unavailable.');
    return;
  }

  const renderer = api.renderer;
  const proto = Object.getPrototypeOf(renderer);
  const original = {
    drawGrid: proto.drawGrid,
    getView: proto.getView,
    setView: proto.setView,
    updateScale: proto.updateScale
  };

  renderer.bearing = Number(renderer.bearing || 0);
  renderer.osmEnabled = true;
  renderer.osmTileCache = new Map();
  renderer.satelliteLayers = [];
  renderer.satelliteOpacity = 0.65;

  function normalizeBearing(value) {
    let bearing = Number(value || 0) % 360;
    if (bearing < 0) bearing += 360;
    return bearing;
  }

  function rotateVector(x, y, radians) {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [x * cos - y * sin, x * sin + y * cos];
  }

  function projectWorld(instance, worldX, worldY) {
    const centerWorld = instance.lngLatToWorld(instance.center[0], instance.center[1]);
    let dx = worldX - centerWorld.x;
    if (dx > 0.5) dx -= 1;
    if (dx < -0.5) dx += 1;
    const dy = worldY - centerWorld.y;
    const scale = instance.worldSize();
    const pitchFactor = Math.max(0.25, Math.cos(instance.pitchRadians()));
    const [rx, ry] = rotateVector(dx * scale, dy * scale * pitchFactor, -instance.bearing * Math.PI / 180);
    return [instance.width / 2 + rx, instance.height / 2 + ry];
  }

  proto.project = function projectWithBearing(coord) {
    const world = this.lngLatToWorld(coord[0], coord[1]);
    return projectWorld(this, world.x, world.y);
  };

  proto.getView = function enhancedGetView() {
    return { ...original.getView.call(this), bearing: normalizeBearing(this.bearing) };
  };

  proto.setView = function enhancedSetView(view, notify = true) {
    if (Number.isFinite(Number(view?.bearing))) this.bearing = normalizeBearing(view.bearing);
    original.setView.call(this, view || {}, notify);
    updateBearingUi();
  };

  proto.setBearing = function setBearing(value, notify = true) {
    this.bearing = normalizeBearing(value);
    this.render();
    updateBearingUi();
    if (notify) this.emitViewChanged();
  };

  proto.setOsmEnabled = function setOsmEnabled(enabled) {
    this.osmEnabled = Boolean(enabled);
    this.render();
    updateAttribution();
  };

  proto.setSatelliteLayers = function setSatelliteLayers(layers) {
    this.satelliteLayers = Array.isArray(layers) ? layers : [];
    this.render();
    updateAttribution();
  };

  proto.setSatelliteOpacity = function setSatelliteOpacity(value) {
    this.satelliteOpacity = Math.max(0, Math.min(1, Number(value)));
    this.render();
  };

  function getOsmTile(instance, z, x, y) {
    const n = 2 ** z;
    const wrappedX = ((x % n) + n) % n;
    const key = `${z}/${wrappedX}/${y}`;
    let record = instance.osmTileCache.get(key);
    if (record) return record;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    record = { image, state: 'loading', lastUsed: Date.now() };
    instance.osmTileCache.set(key, record);
    image.addEventListener('load', () => {
      record.state = 'ready';
      instance.render();
    }, { once: true });
    image.addEventListener('error', () => {
      record.state = 'error';
    }, { once: true });
    image.src = `https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`;
    return record;
  }

  function trimTileCache(instance) {
    if (instance.osmTileCache.size <= 320) return;
    const entries = [...instance.osmTileCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    entries.slice(0, instance.osmTileCache.size - 260).forEach(([key]) => instance.osmTileCache.delete(key));
  }

  function drawOsmTiles(instance) {
    if (!instance.osmEnabled || !navigator.onLine) return;
    const ctx = instance.ctx;
    const z = Math.max(1, Math.min(19, Math.floor(instance.zoom)));
    const n = 2 ** z;
    const center = instance.lngLatToWorld(instance.center[0], instance.center[1]);
    const pitchFactor = Math.max(0.25, Math.cos(instance.pitchRadians()));
    const radiusPx = Math.hypot(instance.width, instance.height) * 0.75 + 420;
    const radiusWorld = radiusPx / instance.worldSize() / pitchFactor;
    const minX = Math.floor((center.x - radiusWorld) * n) - 1;
    const maxX = Math.floor((center.x + radiusWorld) * n) + 1;
    const minY = Math.max(0, Math.floor((center.y - radiusWorld) * n) - 1);
    const maxY = Math.min(n - 1, Math.floor((center.y + radiusWorld) * n) + 1);
    let drawn = 0;

    for (let y = minY; y <= maxY && drawn < 220; y += 1) {
      for (let x = minX; x <= maxX && drawn < 220; x += 1) {
        const record = getOsmTile(instance, z, x, y);
        record.lastUsed = Date.now();
        if (record.state !== 'ready') continue;
        const tl = projectWorld(instance, x / n, y / n);
        const tr = projectWorld(instance, (x + 1) / n, y / n);
        const bl = projectWorld(instance, x / n, (y + 1) / n);
        ctx.save();
        ctx.globalAlpha = 0.96;
        ctx.imageSmoothingEnabled = true;
        ctx.transform(
          (tr[0] - tl[0]) / 256,
          (tr[1] - tl[1]) / 256,
          (bl[0] - tl[0]) / 256,
          (bl[1] - tl[1]) / 256,
          tl[0],
          tl[1]
        );
        ctx.drawImage(record.image, 0, 0, 256, 256);
        ctx.restore();
        drawn += 1;
      }
    }
    trimTileCache(instance);
  }

  function drawSatelliteLayers(instance) {
    const ctx = instance.ctx;
    (instance.satelliteLayers || []).forEach((layer) => {
      if (!layer.image || !Array.isArray(layer.bounds) || layer.bounds.length !== 4) return;
      const [west, south, east, north] = layer.bounds.map(Number);
      const tl = instance.project([west, north]);
      const tr = instance.project([east, north]);
      const bl = instance.project([west, south]);
      const width = layer.image.naturalWidth || layer.image.width;
      const height = layer.image.naturalHeight || layer.image.height;
      if (!width || !height) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, Number(layer.opacity ?? instance.satelliteOpacity)));
      ctx.imageSmoothingEnabled = true;
      ctx.transform(
        (tr[0] - tl[0]) / width,
        (tr[1] - tl[1]) / width,
        (bl[0] - tl[0]) / height,
        (bl[1] - tl[1]) / height,
        tl[0],
        tl[1]
      );
      ctx.drawImage(layer.image, 0, 0, width, height);
      ctx.restore();
    });
  }

  proto.drawGrid = function enhancedDrawGrid() {
    drawOsmTiles(this);
    drawSatelliteLayers(this);
    original.drawGrid.call(this);
  };

  proto.updateScale = function enhancedUpdateScale() {
    original.updateScale.call(this);
    const badge = document.getElementById('bearingBadge');
    if (badge) badge.textContent = `方位 ${Math.round(normalizeBearing(this.bearing))}°`;
  };

  function installPointerControls() {
    const canvas = renderer.canvas;
    let gesture = null;

    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.setPointerCapture(event.pointerId);
      gesture = {
        pointerId: event.pointerId,
        mode: event.button === 2 || event.shiftKey ? 'rotate' : 'pan',
        startX: event.clientX,
        startY: event.clientY,
        startCenter: renderer.lngLatToWorld(renderer.center[0], renderer.center[1]),
        startBearing: renderer.bearing,
        startPitch: renderer.pitch,
        moved: false
      };
    }, true);

    canvas.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.hypot(dx, dy) > 4) gesture.moved = true;

      if (gesture.mode === 'rotate') {
        renderer.bearing = normalizeBearing(gesture.startBearing + dx * 0.35);
        renderer.pitch = Math.max(0, Math.min(65, gesture.startPitch - dy * 0.28));
      } else {
        const [ux, uy] = rotateVector(dx, dy, renderer.bearing * Math.PI / 180);
        const scale = renderer.worldSize();
        const pitchFactor = Math.max(0.25, Math.cos(renderer.pitchRadians()));
        renderer.center = renderer.worldToLngLat(
          gesture.startCenter.x - ux / scale,
          Math.max(0.001, Math.min(0.999, gesture.startCenter.y - uy / (scale * pitchFactor)))
        );
      }
      renderer.render();
      updateBearingUi();
    }, true);

    const endGesture = (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const wasMoved = gesture.moved;
      gesture = null;
      if (!wasMoved && event.button === 0) renderer.handleClick(event.offsetX, event.offsetY);
      renderer.emitViewChanged();
    };

    canvas.addEventListener('pointerup', endGesture, true);
    canvas.addEventListener('pointercancel', endGesture, true);
  }

  function updateBearingUi() {
    const badge = document.getElementById('bearingBadge');
    if (badge) badge.textContent = `方位 ${Math.round(normalizeBearing(renderer.bearing))}°`;
    const toggle = document.getElementById('toggle3dButton');
    if (toggle) toggle.title = '2D・3D切替。右ドラッグまたはShift+ドラッグで方位回転';
  }

  async function loadRegionCatalog() {
    const select = document.getElementById('catalogSelect');
    const button = document.getElementById('installSampleButton');
    if (!select || !button) return;
    const response = await fetch('./data/catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`地域カタログを取得できません: HTTP ${response.status}`);
    const json = await response.json();
    const entries = Array.isArray(json.packs) ? json.packs : [];
    select.replaceChildren();
    entries.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      option.dataset.url = entry.url;
      option.dataset.fallbackUrl = entry.fallbackUrl || '';
      select.appendChild(option);
    });
    button.textContent = '選択地域をダウンロード';

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const option = select.selectedOptions[0];
      if (!option) return;
      try {
        await api.installPackFromUrl(option.dataset.url, option.textContent);
      } catch (error) {
        if (option.dataset.fallbackUrl && String(error.message).includes('GZIP')) {
          await api.installPackFromUrl(option.dataset.fallbackUrl, `${option.textContent}（非圧縮）`);
        } else {
          throw error;
        }
      }
    }, true);
  }

  function intersects(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return true;
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  }

  function openLayerDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('saikan-alos2-layers-v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('layers')) {
          request.result.createObjectStore('layers', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('ALOS-2レイヤーDBを開けません。'));
    });
  }

  function layerRequest(db, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('layers', mode);
      const request = action(tx.objectStore('layers'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('ALOS-2レイヤーDB処理に失敗しました。'));
    });
  }

  async function sha256Hex(blob) {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function imageFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = 'async';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('衛星画像を読み込めません。'));
        image.src = url;
      });
      image.__objectUrl = url;
      return image;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  async function refreshInstalledAlosLayers() {
    const db = await openLayerDb();
    const records = await layerRequest(db, 'readonly', (store) => store.getAll());
    db.close();
    const activeBounds = api.activePack?.manifest?.bounds || null;
    const visible = records.filter((record) => intersects(record.bounds, activeBounds));
    const layers = [];
    for (const record of visible) {
      layers.push({ ...record, image: await imageFromBlob(record.blob) });
    }
    (renderer.satelliteLayers || []).forEach((layer) => {
      if (layer.image?.__objectUrl) URL.revokeObjectURL(layer.image.__objectUrl);
    });
    renderer.setSatelliteLayers(layers);
    const info = document.getElementById('alos2Info');
    if (info) info.textContent = layers.length ? `ALOS-2レイヤー ${layers.length}件を表示中` : 'この地域に保存済みのALOS-2レイヤーはありません。';
  }

  async function loadAlosCatalog() {
    const select = document.getElementById('alos2ProductSelect');
    const button = document.getElementById('installAlos2Button');
    const clearButton = document.getElementById('clearAlos2Button');
    const info = document.getElementById('alos2Info');
    if (!select || !button) return;

    const response = await fetch('./data/alos2/catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`ALOS-2カタログを取得できません: HTTP ${response.status}`);
    const catalog = await response.json();
    const products = Array.isArray(catalog.products) ? catalog.products : [];
    select.replaceChildren();

    if (!products.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '表示可能な軽量レイヤーは未登録';
      select.appendChild(option);
      button.disabled = false;
      button.textContent = 'ALOS-2公開状況を確認';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const url = catalog.officialIndexUrl;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        if (info) info.textContent = 'JAXAの公開ページを開きました。SAIKANへ反映するにはWeb表示用に軽量変換したレイヤーの登録が必要です。';
      });
    } else {
      products.forEach((product) => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.name}${product.observedAt ? ` / ${product.observedAt}` : ''}`;
        select.appendChild(option);
      });
      button.addEventListener('click', async () => {
        const product = products.find((item) => item.id === select.value);
        if (!product) return;
        const activeBounds = api.activePack?.manifest?.bounds || null;
        if (activeBounds && product.bounds && !intersects(product.bounds, activeBounds)) {
          throw new Error('選択したALOS-2データは現在の地域パック範囲と重なりません。');
        }
        if (!product.imageUrl) {
          if (product.sourceUrl) window.open(product.sourceUrl, '_blank', 'noopener,noreferrer');
          throw new Error('このプロダクトは公式原データのみです。Web表示用レイヤーはまだ生成されていません。');
        }
        button.disabled = true;
        try {
          if (info) info.textContent = 'ALOS-2レイヤーをダウンロードしています…';
          const imageResponse = await fetch(product.imageUrl, { cache: 'no-store' });
          if (!imageResponse.ok) throw new Error(`ALOS-2レイヤー取得失敗: HTTP ${imageResponse.status}`);
          const blob = await imageResponse.blob();
          if (product.sha256) {
            const actual = await sha256Hex(blob);
            if (actual.toLowerCase() !== String(product.sha256).toLowerCase()) throw new Error('ALOS-2レイヤーのSHA-256が一致しません。');
          }
          const db = await openLayerDb();
          await layerRequest(db, 'readwrite', (store) => store.put({
            id: product.id,
            name: product.name,
            observedAt: product.observedAt || null,
            bounds: product.bounds,
            opacity: product.opacity ?? 0.65,
            attribution: product.attribution || 'ALOS-2/PALSAR-2: JAXA EORC',
            sourceUrl: product.sourceUrl || null,
            downloadedAt: new Date().toISOString(),
            blob
          }));
          db.close();
          await refreshInstalledAlosLayers();
          api.toast(`ALOS-2レイヤー「${product.name}」を保存・反映しました。`, 'success');
        } finally {
          button.disabled = false;
        }
      });
    }

    clearButton?.addEventListener('click', async () => {
      if (!confirm('端末に保存したALOS-2レイヤーをすべて削除しますか？')) return;
      const db = await openLayerDb();
      await layerRequest(db, 'readwrite', (store) => store.clear());
      db.close();
      await refreshInstalledAlosLayers();
      api.toast('ALOS-2レイヤーを削除しました。', 'success');
    });

    const opacity = document.getElementById('alos2Opacity');
    opacity?.addEventListener('input', () => renderer.setSatelliteOpacity(Number(opacity.value) / 100));
    await refreshInstalledAlosLayers();
  }

  function updateAttribution() {
    const target = document.getElementById('attributionText');
    if (!target) return;
    let text = target.textContent
      .replace(/\s*\|\s*背景地図：© OpenStreetMap contributors/g, '')
      .replace(/\s*\|\s*衛星レイヤー：JAXA ALOS-2\/PALSAR-2[^|]*/g, '');
    if (renderer.osmEnabled) text += ' | 背景地図：© OpenStreetMap contributors';
    if (renderer.satelliteLayers?.length) text += ' | 衛星レイヤー：JAXA ALOS-2/PALSAR-2（SAIKANで表示用加工）';
    target.textContent = text;
  }

  function bindUi() {
    const osm = document.getElementById('osmBasemap');
    if (osm) {
      osm.checked = true;
      osm.addEventListener('change', () => renderer.setOsmEnabled(osm.checked));
    }
    document.getElementById('bearingResetButton')?.addEventListener('click', () => renderer.setBearing(0));
    document.getElementById('packSelect')?.addEventListener('change', () => setTimeout(() => refreshInstalledAlosLayers().catch(console.error), 300));
    const attribution = document.getElementById('attributionText');
    if (attribution) new MutationObserver(updateAttribution).observe(attribution, { childList: true, characterData: true, subtree: true });
  }

  async function init() {
    installPointerControls();
    bindUi();
    updateBearingUi();
    updateAttribution();
    await Promise.allSettled([loadRegionCatalog(), loadAlosCatalog()]);
    renderer.render();
  }

  init().catch((error) => {
    console.error(error);
    api.toast(error.message || String(error), 'error', 7500);
  });
})();
