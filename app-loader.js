(() => {
  'use strict';

  const VERSION = '0.2.1';

  function setFailure(message) {
    console.error(message);
    const region = document.getElementById('catalogSelect');
    const alos = document.getElementById('alos2ProductSelect');
    const regionInfo = document.getElementById('packDetails');
    const alosInfo = document.getElementById('alos2Info');
    const regionButton = document.getElementById('installSampleButton');
    const alosButton = document.getElementById('installAlos2Button');

    if (region) region.innerHTML = '<option value="">アプリ初期化に失敗しました</option>';
    if (alos) alos.innerHTML = '<option value="">アプリ初期化に失敗しました</option>';
    if (regionInfo) regionInfo.textContent = message;
    if (alosInfo) alosInfo.textContent = message;
    if (regionButton) regionButton.disabled = true;
    if (alosButton) alosButton.disabled = true;
  }

  async function loadPatchedApplication() {
    const response = await fetch(`./app-v2.js?v=${VERSION}&t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`app-v2.jsを取得できません: HTTP ${response.status}`);

    let source = await response.text();

    const renderNeedle = '      updateBearingBadge();\n    }\n\n    getTile';
    const renderReplacement = '      updateBearingBadge(this);\n    }\n\n    getTile';
    if (!source.includes(renderNeedle)) {
      throw new Error('修正対象の描画処理が見つかりません。アプリ本体とローダーの版が一致していません。');
    }
    source = source.replace(renderNeedle, renderReplacement);

    const functionNeedle = [
      '  function updateBearingBadge() {',
      '    dom.bearingBadge.textContent = `方位 ${Math.round(normalizeBearing(renderer.bearing))}°`;',
      "    dom.toggle3dButton.textContent = renderer.pitch > 5 ? '2D' : '3D';",
      '  }'
    ].join('\n');
    const functionReplacement = [
      '  function updateBearingBadge(instance = null) {',
      '    const target = instance || renderer;',
      '    dom.bearingBadge.textContent = `方位 ${Math.round(normalizeBearing(target.bearing))}°`;',
      "    dom.toggle3dButton.textContent = target.pitch > 5 ? '2D' : '3D';",
      '  }'
    ].join('\n');
    if (!source.includes(functionNeedle)) {
      throw new Error('修正対象の方位表示処理が見つかりません。');
    }
    source = source.replace(functionNeedle, functionReplacement);
    source = source.replace("const APP_VERSION = '0.2.0';", "const APP_VERSION = '0.2.1';");

    const blob = new Blob([source], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const script = document.createElement('script');
    script.src = blobUrl;
    script.async = false;
    script.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
    script.addEventListener('error', () => {
      URL.revokeObjectURL(blobUrl);
      setFailure('修正版アプリの実行に失敗しました。ページを再読み込みしてください。');
    }, { once: true });
    document.head.appendChild(script);
  }

  loadPatchedApplication().catch((error) => {
    setFailure(error?.message || String(error));
  });
})();
