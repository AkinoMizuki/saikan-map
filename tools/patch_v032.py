from pathlib import Path

path = Path('app-v3.js')
source = path.read_text(encoding='utf-8')

replacements = [
    ("const APP_VERSION = '0.3.1';", "const APP_VERSION = '0.3.2';"),
    (
        "let appMode = 'resident';",
        "let appMode = (()=>{try{const value=localStorage.getItem('saikan-app-mode');return ['resident','rescue','hq'].includes(value)?value:'resident';}catch{return 'resident';}})();"
    ),
]

for needle, replacement in replacements:
    if needle not in source:
        raise SystemExit(f'patch target not found: {needle}')
    source = source.replace(needle, replacement, 1)

mode_code = r'''
  function applyAppMode(mode) {
    const allowed = ['resident', 'rescue', 'hq'];
    const previousMode = appMode;
    appMode = allowed.includes(mode) ? mode : 'resident';
    try { localStorage.setItem('saikan-app-mode', appMode); } catch {}
    document.body.dataset.appMode = appMode;

    document.querySelectorAll('.mode-button').forEach((button) => {
      const active = button.dataset.mode === appMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    const priorityPanel = dom.decisionSummary?.closest('.panel-section');
    let modeSummary = document.getElementById('modeFunctionSummary');
    if (!modeSummary && priorityPanel) {
      modeSummary = document.createElement('div');
      modeSummary.id = 'modeFunctionSummary';
      modeSummary.className = 'mode-function-summary';
      priorityPanel.insertBefore(modeSummary, dom.decisionSummary);
    }

    const modeInfo = {
      resident: {
        title: '住民・避難支援者モード',
        text: '現在地から避難候補を探し、通行不能・浸水・倒壊などを報告します。救助隊向けの衛星解析・進入操作・管理機能は隠します。'
      },
      rescue: {
        title: '救助隊・現地支援者モード',
        text: '救助目的地と進入ルートを指定し、道路閉塞・要救助区域・衛星更新を確認します。破壊的なデータ管理は隠します。'
      },
      hq: {
        title: '対策本部モード',
        text: '衛星・防災更新、全現地報告、QR共有、印刷、表示レイヤー、データ管理を集約します。個人向け経路操作は隠します。'
      }
    }[appMode];
    if (modeSummary) modeSummary.innerHTML = `<strong>${modeInfo.title}</strong><span>${modeInfo.text}</span>`;

    const section = (id) => document.getElementById(id)?.closest('.panel-section');
    const setSectionModes = (element, modes) => {
      if (element) element.hidden = !modes.includes(appMode);
    };

    setSectionModes(section('catalogSelect'), ['resident', 'rescue', 'hq']);
    setSectionModes(section('updateCatalogSelect'), ['rescue', 'hq']);
    setSectionModes(section('calculateEvacuationButton'), ['resident', 'rescue']);
    setSectionModes(section('obstacleType'), ['resident', 'rescue', 'hq']);
    setSectionModes(section('createQrShareButton'), ['resident', 'rescue', 'hq']);
    setSectionModes(section('osmBasemap'), ['rescue', 'hq']);
    setSectionModes(section('prepareOfflineButton'), ['resident', 'rescue', 'hq']);
    setSectionModes(section('fullResetButton'), ['hq']);

    const resident = appMode === 'resident';
    const rescue = appMode === 'rescue';
    dom.calculateEvacuationButton.hidden = !resident;
    dom.setDestinationButton.hidden = !rescue;
    dom.calculateRescueRouteButton.hidden = !rescue;

    const vehicleOption = dom.travelMode?.querySelector('option[value="vehicle"]');
    if (vehicleOption) vehicleOption.hidden = resident;
    if (resident && dom.travelMode.value === 'vehicle') dom.travelMode.value = 'foot';

    const routeSection = section('calculateEvacuationButton');
    const routeHeading = routeSection?.querySelector('h2');
    if (routeHeading) {
      routeHeading.textContent = resident
        ? '避難先と安全な避難ルート'
        : '救助目的地への安全な進入ルート';
    }
    dom.calculateEvacuationButton.textContent = '避難先と安全な経路を探す';
    dom.calculateRescueRouteButton.textContent = '救助目的地への進入ルートを計算';

    const obstacleSection = section('obstacleType');
    const obstacleHeading = obstacleSection?.querySelector('h2');
    if (obstacleHeading) {
      obstacleHeading.textContent = resident
        ? '危険・通行不能を報告'
        : rescue
          ? '障害・要救助区域を記録'
          : '全現地報告・危険エリア管理';
    }

    if (previousMode !== appMode) {
      selectedRoute = null;
      if (dom.routeResults) {
        dom.routeResults.textContent = resident
          ? '現在地または出発点を設定し、避難候補を計算してください。'
          : rescue
            ? '出発点と救助目的地を指定し、進入ルートを計算してください。'
            : '';
      }
    }

    updateDecision();
    map.render();
  }
'''

insert_needle = "  function updateDecision(){"
if insert_needle not in source:
    raise SystemExit('updateDecision insertion target not found')
source = source.replace(insert_needle, mode_code + "\n" + insert_needle, 1)

decision_needle = "dom.decisionSummary.textContent=text;dom.mapDecisionBanner.textContent=text;"
decision_replacement = """if(appMode==='hq'){if(!activePack){text='対策本部モード: 対象地域を選択してください。';cls='warning';}else{const roadState=roadRecord?`道路網 ${roadRecord.ways.length}本`:'道路網未取得';text=`対策本部モード: 現地報告 ${observations.length}件（重大 ${severe}件）/ 観測更新 ${updates.length}件 / ${roadState}。衛星・防災更新と共有情報を確認してください。`;cls=severe?'danger':updates.length?'safe':'warning';}}else if(appMode==='rescue'&&activePack){if(!roadRecord){text='救助隊モード: OSM道路網を保存して進入経路計算を準備してください。';cls='warning';}else if(!startPoint){text='救助隊モード: 救助隊の出発点を現在地または地図で指定してください。';cls='warning';}else if(!destinationPoint){text='救助隊モード: 救助目的地を地図で指定してください。';cls='warning';}else if(selectedRoute){text=`救助隊モード: ${selectedRoute.name}への障害回避進入ルートを表示中です。`;cls='safe';}else{text=`救助隊モード: 現地障害 ${blocking}件を考慮し、救助目的地への進入ルートを計算できます。`;cls=blocking?'warning':'safe';}}dom.decisionSummary.textContent=text;dom.mapDecisionBanner.textContent=text;"""
if decision_needle not in source:
    raise SystemExit('decision override target not found')
source = source.replace(decision_needle, decision_replacement, 1)

event_needle = "document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>{appMode=b.dataset.mode;document.querySelectorAll('.mode-button').forEach(x=>x.classList.toggle('active',x===b));updateDecision();}));"
event_replacement = "document.querySelectorAll('.mode-button').forEach(b=>b.addEventListener('click',()=>applyAppMode(b.dataset.mode)));"
if event_needle not in source:
    raise SystemExit('mode event target not found')
source = source.replace(event_needle, event_replacement, 1)

init_needle = "async function init(){dom.versionBadge.textContent=`ver ${APP_VERSION}`;bindEvents();updateNetwork();"
init_replacement = "async function init(){dom.versionBadge.textContent=`ver ${APP_VERSION}`;bindEvents();applyAppMode(appMode);updateNetwork();"
if init_needle not in source:
    raise SystemExit('init mode target not found')
source = source.replace(init_needle, init_replacement, 1)

path.write_text(source, encoding='utf-8')
