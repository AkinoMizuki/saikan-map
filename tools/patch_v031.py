from pathlib import Path

path = Path('app-v3.js')
source = path.read_text(encoding='utf-8')

replacements = [
    ("const APP_VERSION = '0.3.0';", "const APP_VERSION = '0.3.1';"),
    ('best=id;', 'best=Number(id);'),
    (
        "async function downloadUpdate(){const p=",
        "async function downloadUpdate(){if(!activePack)throw new Error('先に地域を選択してください。');const p="
    ),
    (
        "async function importUpdate(file){const j=",
        "async function importUpdate(file){if(!activePack)throw new Error('先に地域を選択してください。');const j="
    ),
    (
        "async function finishDraw(){if(!map.drawing)return;",
        "async function finishDraw(){if(!activePack)throw new Error('先に地域を選択してください。');if(!map.drawing)return;"
    ),
    (
        "hit=pointInPolygon(mid,g.coordinates[0])||pointInPolygon(a,g.coordinates[0])||pointInPolygon(b,g.coordinates[0]);",
        "const ring=g.coordinates[0];hit=pointInPolygon(mid,ring)||pointInPolygon(a,ring)||pointInPolygon(b,ring)||ring.some((c,i)=>i>0&&segmentsIntersect(a,b,ring[i-1],c));"
    ),
    (
        "hit=g.coordinates.some(x=>pointInPolygon(mid,x[0]));",
        "hit=g.coordinates.some(x=>{const ring=x[0];return pointInPolygon(mid,ring)||pointInPolygon(a,ring)||pointInPolygon(b,ring)||ring.some((c,i)=>i>0&&segmentsIntersect(a,b,ring[i-1],c));});"
    ),
    (
        "function renderRoutes(items){dom.routeResults.replaceChildren();items.forEach((x,i)=>{const d=document.createElement('div');d.className='route-card';const name=x.shelter.properties?.name||'候補',km=(x.cost/1000).toFixed(2);d.innerHTML=`<strong>${i+1}. ${name}</strong><span>危険回避コスト換算 ${km} km / ${Math.max(1,Math.round(x.cost/(dom.travelMode.value==='vehicle'?500:80)))}分目安</span>`;",
        "function routeDistance(coords){let total=0;for(let i=1;i<coords.length;i++)total+=haversine(coords[i-1],coords[i]);return total;}\n  function renderRoutes(items){dom.routeResults.replaceChildren();items.forEach((x,i)=>{const d=document.createElement('div');d.className='route-card';const name=x.shelter.properties?.name||'候補',distance=routeDistance(x.coords),km=(distance/1000).toFixed(2),speed=dom.travelMode.value==='vehicle'?500:dom.travelMode.value==='wheelchair'?45:80,risk=(x.cost/Math.max(distance,1)).toFixed(1);d.innerHTML=`<strong>${i+1}. ${name}</strong><span>実距離 ${km} km / 約${Math.max(1,Math.round(distance/speed))}分 / 危険係数 ${risk}</span>`;"
    ),
    (
        "db.close();indexedDB.deleteDatabase(DB_NAME);const n=await caches.keys();",
        "db.close();await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(DB_NAME);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('別タブを閉じてください。'));});const n=await caches.keys();"
    ),
    (
        "properties:{packId:activePack?.id||'global',type:dom.obstacleType.value,severity:Number(dom.obstacleSeverity.value),note:dom.obstacleNote.value.trim(),source:'field_report',createdAt:now,updatedAt:now,status:'active'}",
        "properties:{packId:activePack?.id||'global',type:dom.obstacleType.value,severity:Number(dom.obstacleSeverity.value),note:dom.obstacleNote.value.trim(),source:'field_report',createdAt:now,updatedAt:now,status:'active',revision:1}"
    )
]

for needle, replacement in replacements:
    if needle not in source:
        raise SystemExit(f'patch target not found: {needle[:90]}')
    source = source.replace(needle, replacement, 1)

shelter_needle = "if(this.layers.shelters)activeData.shelters.features.forEach(f=>this.drawFeature(f,{fill:'#2874b5',radius:8}));"
shelter_replacement = "if(this.layers.shelters)activeData.shelters.features.forEach(f=>{this.drawFeature(f,{fill:'#2874b5',radius:8});const p=this.project(f.geometry.coordinates),name=f.properties?.name||'避難候補';this.ctx.font='600 11px system-ui';this.ctx.lineWidth=3;this.ctx.strokeStyle='rgba(255,255,255,.96)';this.ctx.strokeText(name,p[0]+11,p[1]+4);this.ctx.fillStyle='#17324d';this.ctx.fillText(name,p[0]+11,p[1]+4);});"
if shelter_needle not in source:
    raise SystemExit('shelter render target not found')
source = source.replace(shelter_needle, shelter_replacement, 1)

point_needle = "if(startPoint)this.drawFeature({geometry:{type:'Point',coordinates:startPoint}},{fill:'#18a15f',radius:9});if(destinationPoint)this.drawFeature({geometry:{type:'Point',coordinates:destinationPoint}},{fill:'#8d36b0',radius:9});"
point_replacement = "if(startPoint){this.drawFeature({geometry:{type:'Point',coordinates:startPoint}},{fill:'#18a15f',radius:9});const p=this.project(startPoint);this.ctx.font='700 12px system-ui';this.ctx.lineWidth=3;this.ctx.strokeStyle='#fff';this.ctx.strokeText('出発点',p[0]+12,p[1]+4);this.ctx.fillStyle='#12653f';this.ctx.fillText('出発点',p[0]+12,p[1]+4);}if(destinationPoint){this.drawFeature({geometry:{type:'Point',coordinates:destinationPoint}},{fill:'#8d36b0',radius:9});const p=this.project(destinationPoint);this.ctx.font='700 12px system-ui';this.ctx.lineWidth=3;this.ctx.strokeStyle='#fff';this.ctx.strokeText('救助目的地',p[0]+12,p[1]+4);this.ctx.fillStyle='#692282';this.ctx.fillText('救助目的地',p[0]+12,p[1]+4);}"
if point_needle not in source:
    raise SystemExit('start/destination render target not found')
source = source.replace(point_needle, point_replacement, 1)

api_code = r'''
  window.SAIKAN_SHARE_API = {
    getContext() {
      const cleanObservations = observations.map((item) => ({
        type: 'Feature',
        id: String(item.id || item.properties?.id || ''),
        geometry: item.geometry,
        properties: {
          ...(item.properties || {}),
          revision: Number(item.properties?.revision || 1),
          packId: item.properties?.packId || item.packId || activePack?.id || 'global'
        }
      }));
      return {
        appVersion: APP_VERSION,
        packId: activePack?.id || 'global',
        packName: activePack?.name || '地域未選択',
        mode: appMode,
        decision: dom.decisionSummary.textContent || '',
        freshness: dom.freshnessSummary.textContent || '',
        route: selectedRoute ? {
          name: selectedRoute.name,
          cost: selectedRoute.cost,
          coordinates: selectedRoute.coordinates
        } : null,
        observations: cleanObservations,
        sourceStatuses: {
          alos2: dom.alosStatus.textContent || '',
          qzss: dom.qzssStatus.textContent || '',
          weather: dom.jmaStatus.textContent || ''
        }
      };
    },
    getMapCanvas() {
      return dom.mapCanvas;
    },
    async mergeSituation(sharedPackage) {
      const features = Array.isArray(sharedPackage?.observations)
        ? sharedPackage.observations
        : Array.isArray(sharedPackage?.features)
          ? sharedPackage.features
          : [];
      if (!features.length) return { added: 0, updated: 0, skipped: 0, invalid: 0 };
      const targetPackId = String(sharedPackage.packId || activePack?.id || 'global');
      const existingRecords = await dbGetByIndex('observations', 'packId', targetPackId);
      const existing = new Map(existingRecords.map((item) => [String(item.id), item]));
      let added = 0, updated = 0, skipped = 0, invalid = 0;
      for (const raw of features) {
        if (raw?.type !== 'Feature' || !raw.geometry || !['Point','LineString','Polygon','MultiPolygon'].includes(raw.geometry.type)) {
          invalid += 1;
          continue;
        }
        const id = String(raw.id || raw.properties?.id || crypto.randomUUID());
        const props = {
          ...(raw.properties || {}),
          packId: targetPackId,
          revision: Math.max(1, Number(raw.properties?.revision || 1)),
          updatedAt: raw.properties?.updatedAt || raw.properties?.updated_at || new Date().toISOString(),
          createdAt: raw.properties?.createdAt || raw.properties?.created_at || new Date().toISOString()
        };
        const incoming = { type: 'Feature', id, packId: targetPackId, geometry: raw.geometry, properties: props };
        const current = existing.get(id);
        if (!current) {
          await dbPut('observations', incoming);
          existing.set(id, incoming);
          added += 1;
          continue;
        }
        const currentRevision = Number(current.properties?.revision || 1);
        const incomingRevision = Number(props.revision || 1);
        const currentTime = Date.parse(current.properties?.updatedAt || current.properties?.updated_at || 0) || 0;
        const incomingTime = Date.parse(props.updatedAt || 0) || 0;
        if (incomingRevision > currentRevision || (incomingRevision === currentRevision && incomingTime > currentTime)) {
          await dbPut('observations', incoming);
          existing.set(id, incoming);
          updated += 1;
        } else {
          skipped += 1;
        }
      }
      if (activePack?.id === targetPackId) {
        observations = await dbGetByIndex('observations', 'packId', targetPackId);
        observations.sort((a,b) => String(b.properties?.updatedAt || '').localeCompare(String(a.properties?.updatedAt || '')));
        selectedRoute = null;
        renderObservationList();
        map.render();
        updateDecision();
        await refreshStorage();
      }
      return { added, updated, skipped, invalid, targetPackId };
    }
  };
'''
init_needle = "  async function init(){dom.versionBadge.textContent=`ver ${APP_VERSION}`;"
if init_needle not in source:
    raise SystemExit('init target not found')
source = source.replace(init_needle, api_code + "\n" + init_needle, 1)

path.write_text(source, encoding='utf-8')
