(() => {
  'use strict';

  const VERSION = '0.3.0';
  const PARTS = [
    './app-v3c/part-00.txt',
    './app-v3c/part-01.txt',
    './app-v3c/part-02.txt',
    './app-v3c/part-03.txt',
    './app-v3c/part-04.txt'
  ];

  function showFailure(message) {
    console.error(message);
    const decision = document.getElementById('decisionSummary');
    const banner = document.getElementById('mapDecisionBanner');
    if (decision) decision.textContent = message;
    if (banner) {
      banner.textContent = message;
      banner.className = 'map-decision-banner danger';
    }
  }

  async function start() {
    const texts = [];
    for (const path of PARTS) {
      const response = await fetch(`${path}?v=${VERSION}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${path}を取得できません: HTTP ${response.status}`);
      texts.push(await response.text());
    }
    const source = texts.join('');
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const script = document.createElement('script');
    script.src = blobUrl;
    script.async = false;
    script.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
    script.addEventListener('error', () => {
      URL.revokeObjectURL(blobUrl);
      showFailure('SAIKAN 0.3の実行に失敗しました。アプリキャッシュを消去して再読み込みしてください。');
    }, { once: true });
    document.head.appendChild(script);
  }

  start().catch((error) => showFailure(error?.message || String(error)));
})();
