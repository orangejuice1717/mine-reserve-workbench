
(() => {
'use strict';
const CRS='EPSG:32751', SLOPE_DEG=60, TAN_SLOPE=Math.tan(SLOPE_DEG*Math.PI/180), DX=12.5, DY=12.5, DZ=1, BLOCK_VOL=DX*DY*DZ;
let rasterBounds={minX:303559.56090125284,minY:9787504.855706707,maxX:313023.06090125284,maxY:9794742.855706707};
const DRIVE_ORTHO_FOLDER_ID = '1AuGJ9pkDyCmX4HCqfTjUMsl0HyPUjz-o';

const colors={'OB/Waste':'#78b4f2','LLIM':'#f0d28b','HLIM':'#7fe5d4','LGSO':'#f18183','MGSO':'#f1ef70','HGSO':'#91e875','VHGSO':'#df67cb','LIM <1.15':'#9aa6ad','SAP <1.25':'#b6a1c3'};
const classOrder=['OB/Waste','LLIM','HLIM','LGSO','MGSO','HGSO','VHGSO','LIM <1.15','SAP <1.25'];
const els=id=>document.getElementById(id); const canvas=els('mapCanvas'), ctx=canvas.getContext('2d'); const orthoLayer=els('orthoLayer');
const app={rows:[],csvName:'remain_reserve_sept0.csv',collars:[],collarName:'collars.csv',assayRows:[],assaysByHole:new Map(),assayLoaded:false,assayLoadError:'',assayCurrentHole:null,showCollars:true,showCollarLabels:false,selectedCollar:null,collarBounds:null,raster:orthoLayer,rasterReady:false,showOrtho:true,showBlocks:true,materialFilter:'all',gpsPosition:null,gpsWatchId:null,gpsFollowing:false,gpsFirstWatchFix:false,centerX:311000,centerY:9790400,scale:0.22,dpr:1,viewW:900,viewH:600,drag:null,drawing:false,draft:[],floorPoly:[],crestPoly:[],designApplied:false,selected:new Uint8Array(0),stats:null,allBounds:null,initialFitDone:false,csvLoadedOnce:false,viewRestored:false,viewTouched:false,restoredDesign:false,csvHeaders:[],cutDepth:1,selectionMode:'layer',topRL:null,columnTopByKey:new Map(),polySummary:null,polygonRowIndices:[],polyStageSummary:null,polygonStageRowIndices:[]};
let mrMapRotation = 0;
function mrApplyMapRotation(){
  const canvas=els('mapCanvas'),img=els('orthoLayer'),box=els('mapbox');
  if(!canvas||!img||!box)return;
  const r=box.getBoundingClientRect(),c=canvas.getBoundingClientRect();
  canvas.style.transformOrigin='center center';
  canvas.style.transform=`rotate(${mrMapRotation}deg)`;
  const left=parseFloat(img.style.left)||0,top=parseFloat(img.style.top)||0;
  img.style.transformOrigin=`${r.width/2-left}px ${r.height/2-top}px`;
  img.style.transform=`rotate(${mrMapRotation}deg)`;
  const north=box.querySelector('.north');
  if(north){const arrow=north.querySelector('b');if(arrow)arrow.style.transform=`rotate(${-mrMapRotation}deg)`;north.title='Orientasi peta '+((360-mrMapRotation)%360).toFixed(0)+'° dari utara';}
}
function mrRotateMap(delta){mrMapRotation=((mrMapRotation+delta)%360+360)%360;mrApplyMapRotation();draw();}

function mrNorthUp(){mrMapRotation=0;mrApplyMapRotation();draw();toast('Orientasi kembali ke utara (0°).');}
function mrEnableOrientationControls(){
  const bind=(id,fn)=>{const el=els(id);if(el)el.addEventListener('click',fn);};
  // Desktop: hold Ctrl and drag the mouse around the map center to rotate.
  const canvas=els('mapCanvas'),box=els('mapbox');
  if(!canvas||!box||canvas.dataset.mrCtrlRotate==='1')return;
  canvas.dataset.mrCtrlRotate='1';
  let rotating=null;
  const angleAt=e=>{const r=box.getBoundingClientRect();return Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2))*180/Math.PI;};
  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.ctrlKey&&e.button===0){
      e.preventDefault();e.stopImmediatePropagation();
      rotating={pointerId:e.pointerId,startAngle:angleAt(e),startRotation:mrMapRotation};
      try{canvas.setPointerCapture(e.pointerId)}catch(_){}
      canvas.style.cursor='alias';
    }
  },true);
  canvas.addEventListener('pointermove',e=>{
    if(!rotating||rotating.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    const delta=angleAt(e)-rotating.startAngle;
    mrMapRotation=((rotating.startRotation+delta)%360+360)%360;
    mrApplyMapRotation();draw();
  },true);
  const end=e=>{
    if(!rotating||rotating.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();rotating=null;
    canvas.style.cursor='grab';
  };
  canvas.addEventListener('pointerup',end,true);
  canvas.addEventListener('pointercancel',end,true);
}
const fmt=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('id-ID',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const short=(n)=>Number.isFinite(n)?n.toLocaleString('id-ID',{maximumFractionDigits:1}):'—';
function toast(msg){const t=els('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._timer);toast._timer=setTimeout(()=>t.classList.remove('show'),3200)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function classifyMaterial(sourceClass,ni){
  const source=String(sourceClass||'').trim().toUpperCase();
  if(source.includes('WASTE')||source==='OB'||source.includes('OB/WASTE'))return 'OB/Waste';
  // Source model convention: HGL/MGL/LGL = limonite; HGS/MGS/LGS = saprolite.
  if(['HGL','MGL','LGL'].includes(source)||source.includes('LIMONITE')){
    if(ni<1.15)return 'LIM <1.15';
    if(ni<1.30)return 'LLIM';
    return 'HLIM';
  }
  if(['HGS','MGS','LGS'].includes(source)||source.includes('SAPROLITE')){
    if(ni<1.25)return 'SAP <1.25';
    if(ni<1.45)return 'LGSO';
    if(ni<1.55)return 'MGSO';
    if(ni<1.65)return 'HGSO';
    return 'VHGSO';
  }
  return source||'OTHER';
}
function parseCSV(text){
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim().length);
 if(lines.length<2)throw new Error('CSV kosong atau tidak memiliki baris data.');
 const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
 function split(line){let a=[],v='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){v+='"';i++}else q=!q}else if(c===sep&&!q){a.push(v);v=''}else v+=c}a.push(v);return a}
 const headers=split(lines[0]).map(x=>x.trim());const idx={};headers.forEach((h,i)=>idx[h.toLowerCase()]=i);
 for(const h of ['x','y','z'])if(idx[h]===undefined)throw new Error('Kolom koordinat wajib X, Y, Z tidak ditemukan.');
 const get=(a,k)=>{const i=idx[k.toLowerCase()];if(i===undefined)return null;let v=a[i]?.trim()??'';if(!v)return null;const n=Number(v.replace(',','.'));return Number.isFinite(n)?n:null};
 const out=[],seen=new Set();let defaults=0;
 for(let i=1;i<lines.length;i++){
  const a=split(lines[i]);const x=get(a,'x'),y=get(a,'y'),z=get(a,'z');if(x===null||y===null||z===null)throw new Error('Baris '+(i+1)+': X, Y, Z wajib angka valid.');
  let sourceCls='';const classIdx=idx['product_sept_2026']??idx['ore_class']??idx['class']??idx['material'];
  if(classIdx!==undefined&&a[classIdx]?.trim())sourceCls=a[classIdx].trim().toUpperCase();
  else if(idx['classification_no']!==undefined){const val=get(a,'classification_no');sourceCls=val===1?'WASTE':`CLASS_${val??'NA'}`}
  const ni=get(a,'ni'),fe=get(a,'fe');
  if(ni===null||fe===null||ni<0||ni>100||fe<0||fe>100)throw new Error('Baris '+(i+1)+': Ni dan Fe wajib 0–100 (%). Nilai kosong tidak dianggap nol.');
  let density=get(a,'densitas')??get(a,'density');
  if(density===null){throw new Error('Baris '+(i+1)+': densitas/density wajib diisi (t/m³).');}
  if(density<=0)throw new Error('Baris '+(i+1)+': densitas harus lebih besar dari nol.');
  const key=[x,y,z].join('|');if(seen.has(key))throw new Error('Baris '+(i+1)+': koordinat XYZ duplikat.');seen.add(key);
  out.push({x,y,z,sourceCls,cls:classifyMaterial(sourceCls,ni),ni,fe,density});
 }
 if(!out.length)throw new Error('CSV tidak berisi block valid.');return {headers,rows:out};
}
function readCsvFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('File CSV tidak bisa dibaca.'));reader.onload=()=>{try{resolve(parseCSV(String(reader.result)))}catch(e){reject(e)}};reader.readAsText(file)})}
function parseCollarCSV(text,sourceName='collars.csv'){
 const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim().length);
 if(lines.length<2)throw new Error('CSV collar kosong atau tidak memiliki baris data.');
 const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
 function split(line){const a=[];let v='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){v+='"';i++}else q=!q}else if(c===sep&&!q){a.push(v);v=''}else v+=c}a.push(v);return a}
 const headers=split(lines[0]).map(x=>x.trim());const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');const idx={};headers.forEach((h,i)=>idx[norm(h)]=i);
 const pick=(names)=>names.map(n=>idx[norm(n)]).find(i=>i!==undefined);
 const idI=pick(['Hole_ID','Hole ID','Hole_Id','Collar_ID','Collar ID','HoleNo','ID']);
 const xI=pick(['X','East','Easting']),yI=pick(['Y','North','Northing']),zI=pick(['Z','RL','Elevation']),depthI=pick(['Depth','Hole_Depth','Total_Depth']),sourceI=pick(['Source_File','Source']);
 if(xI===undefined||yI===undefined||zI===undefined)throw new Error('CSV collar harus mempunyai kolom X, Y, dan Z (urutan kolom bebas).');
 const num=v=>{const t=String(v??'').trim();if(!t)return null;const n=Number(t.replace(',','.'));return Number.isFinite(n)?n:null};
 const seen=new Set(),rows=[];
 for(let i=1;i<lines.length;i++){
   const a=split(lines[i]),x=num(a[xI]),y=num(a[yI]),z=num(a[zI]);if(x===null||y===null||z===null)throw new Error('Baris '+(i+1)+': X, Y, Z wajib angka valid.');
   const id=(idI===undefined?'COLLAR-'+String(rows.length+1):String(a[idI]||'').trim())||('COLLAR-'+String(rows.length+1));
   const depth=depthI===undefined?null:num(a[depthI]);const source=sourceI===undefined?sourceName:String(a[sourceI]||sourceName);
   const key=[id,x.toFixed(3),y.toFixed(3),z.toFixed(3),depth===null?'':depth.toFixed(3)].join('|');
   if(seen.has(key))continue;seen.add(key);rows.push({id,x,y,z,depth,source});
 }
 if(!rows.length)throw new Error('Tidak ada baris collar dengan koordinat X/Y/Z valid.');
 return rows;
}
function readCollarCsvFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('File CSV collar tidak bisa dibaca.'));reader.onload=()=>{try{resolve(parseCollarCSV(String(reader.result),file.name))}catch(e){reject(e)}};reader.readAsText(file)})}
function getDataBounds(rows){let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;for(const r of rows){if(r.x<minX)minX=r.x;if(r.x>maxX)maxX=r.x;if(r.y<minY)minY=r.y;if(r.y>maxY)maxY=r.y;if(r.z<minZ)minZ=r.z;if(r.z>maxZ)maxZ=r.z}return {minX,maxX,minY,maxY,minZ,maxZ}}

const COLLAR_STORAGE_KEY='minereserve-collar-data-v1';
function collarInsideOrtho(c){return c.x>=rasterBounds.minX&&c.x<=rasterBounds.maxX&&c.y>=rasterBounds.minY&&c.y<=rasterBounds.maxY}
function loadCollars(rows,name='collars.csv',persist=false){
  app.collars=rows;app.collarName=name;app.selectedCollar=null;
  app.collarBounds=rows.length?getDataBounds(rows.map(c=>({x:c.x,y:c.y,z:c.z}))):null;
  const inside=rows.reduce((n,c)=>n+(collarInsideOrtho(c)?1:0),0);
  els('collarStatus').textContent=rows.length?'LOADED':'KOSONG';els('collarStatus').style.color=rows.length?'var(--accent)':'var(--red)';
  els('collarCount').textContent=fmt(rows.length);els('collarInsideCount').textContent=fmt(inside);
  els('collarLoadNote').textContent=`Sumber: ${name} · ${fmt(rows.length-inside)} titik di luar footprint ortofoto. Titik tetap dapat dicari dan dipilih.`;
  updateCollarDetails(null);syncCollarToggleUI();
  if(persist){try{localStorage.setItem(COLLAR_STORAGE_KEY,JSON.stringify({name,rows}))}catch(e){toast('Data collar dimuat, tetapi tidak dapat disimpan di browser. Simpan salinan CSV untuk penggunaan berikutnya.')}}
  draw();
}

function normalizeHoleId(value){return String(value??'').trim().toUpperCase()}
function closeAssayLog(){
  const panel=els('assayLogCard');
  if(panel)panel.classList.add('hidden');
  app.assayCurrentHole=null;
  const b=els('viewAssayBtn');
  if(b)b.setAttribute('aria-expanded','false');
}
function updateCollarDetails(c){
  const box=els('collarSelectedInfo');if(!box)return;
  if(!c){
    closeAssayLog();
    box.innerHTML='<div class="hole-name">Belum ada titik dipilih</div><div class="hole-meta">Klik titik collar pada peta atau cari ID untuk melihat koordinat, elevasi, dan kedalaman lubang.</div>';
    return;
  }
  const outside=!collarInsideOrtho(c),depth=(c.depth===null||c.depth===undefined||!Number.isFinite(Number(c.depth)))?'—':fmt(Number(c.depth),2)+' m';
  const samples=app.assaysByHole.get(normalizeHoleId(c.id))||[];
  const assayHint=app.assayLoaded?(samples.length?`${fmt(samples.length)} interval assay tersedia.`:'Belum ada interval assay untuk ID ini.'):(app.assayLoadError?'Data assay gagal dimuat.':'Data assay sedang dimuat…');
  const disabled=(!app.assayLoaded&&!app.assayLoadError)?'disabled':'';
  const label=app.assayLoaded?'Lihat log litologi & assay':(app.assayLoadError?'Cek status assay':'Memuat data assay…');
  box.innerHTML=`<div class="hole-name">${escapeHtml(c.id)}</div><div class="hole-meta">X / Easting: ${fmt(c.x,3)} m<br>Y / Northing: ${fmt(c.y,3)} m<br>Z / RL collar: ${fmt(c.z,3)} m<br>Depth collar: ${depth}<br>Sumber collar: ${escapeHtml(c.source||app.collarName)}<br>${outside?'Di luar footprint ortofoto':'Di dalam footprint ortofoto'}</div><div class="assay-view-row"><button class="primary" id="viewAssayBtn" type="button" ${disabled} aria-expanded="false">Lihat log litologi & assay</button></div><div class="assay-view-hint">${escapeHtml(assayHint)} Profil hanya dibuka jika tombol ditekan.</div>`;
  const b=els('viewAssayBtn');if(b)b.textContent=label;
}
function parseAssayCSV(text,sourceName='assays.csv'){
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim().length);
  if(lines.length<2)throw new Error('CSV assay kosong atau hanya memiliki header.');
  const sep=(lines[0].match(/;/g)||[]).length>(lines[0].match(/,/g)||[]).length?';':',';
  function split(line){const out=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(ch===sep&&!quoted){out.push(value);value=''}else value+=ch}out.push(value);return out}
  const headers=split(lines[0]).map(x=>x.trim());
  const norm=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const idx={};headers.forEach((h,i)=>idx[norm(h)]=i);
  const pick=(names)=>names.map(n=>idx[norm(n)]).find(i=>i!==undefined);
  const idI=pick(['Hole_ID','Hole ID','HoleId','ID']),fromI=pick(['From']),toI=pick(['To']),intervalI=pick(['Interval']);
  const lithI=pick(['Lithology','Layer','Field_Lith','Field Lith']);
  const lithFieldI=pick(['Lithology_Field']),zonaI=pick(['Zona','Zone']);
  if(idI===undefined||fromI===undefined||toI===undefined||lithI===undefined)throw new Error('CSV assay harus punya Hole_ID, From, To, dan Layer/Field_Lith/Lithology.');
  const num=(v)=>{const t=String(v??'').trim();if(!t)return null;const n=Number(t.replace(',','.'));return Number.isFinite(n)?n:null};
  const fields=['Ni','Fe','SiO2','MgO','CaO','Co','Cr2O3','Al2O3','MnO'];const fieldI={};for(const f of fields)fieldI[f]=pick([f,f.replace('2','₂')]);
  const sourceI=pick(['Source_File','SourceFile','Source']);
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const a=split(lines[i]),id=String(a[idI]||'').trim(),from=num(a[fromI]),to=num(a[toI]);
    if(!id||from===null||to===null||to<from)continue;
    const lenRaw=intervalI===undefined?null:num(a[intervalI]),len=(lenRaw!==null&&lenRaw>0)?lenRaw:Math.max(0,to-from);
    const item={id,from,to,interval:len,lithology:String(a[lithI]||'Tidak diketahui').trim()||'Tidak diketahui',lithologyField:lithFieldI===undefined?'Lithology':String(a[lithFieldI]||'Lithology').trim(),zona:zonaI===undefined?'':String(a[zonaI]||'').trim(),source:sourceI===undefined?sourceName:String(a[sourceI]||sourceName).trim()};
    for(const f of fields)item[f.toLowerCase()]=fieldI[f]===undefined?null:num(a[fieldI[f]]);
    rows.push(item);
  }
  if(!rows.length)throw new Error('Tidak ada interval assay valid dalam CSV.');
  rows.sort((a,b)=>normalizeHoleId(a.id).localeCompare(normalizeHoleId(b.id))||a.from-b.from||a.to-b.to);
  return rows;
}
function indexAssays(rows){
  const byHole=new Map();
  for(const row of rows){const key=normalizeHoleId(row.id);if(!byHole.has(key))byHole.set(key,[]);byHole.get(key).push(row)}
  for(const group of byHole.values())group.sort((a,b)=>a.from-b.from||a.to-b.to);
  return byHole;
}
async function loadAssaysUrl(){
  const status=els('assayLoadStatus');
  if(status)status.textContent='Data assay sedang dimuat…';
  if(location.protocol==='file:'){
    app.assayLoadError='Buka aplikasi menggunakan START-Mine-Reserve.cmd atau server HTTPS.';
    if(status)status.textContent=app.assayLoadError;
    if(app.selectedCollar)updateCollarDetails(app.selectedCollar);
    return;
  }
  try{
    const response=await fetch('./assays.csv');
    if(!response.ok)throw new Error(`assays.csv tidak ditemukan (HTTP ${response.status})`);
    const text=await response.text();
    const rows=parseAssayCSV(text,'assays.csv');
    app.assayRows=rows;
    app.assaysByHole=indexAssays(rows);
    app.assayLoaded=true;
    app.assayLoadError='';
    if(status)status.textContent=`LOADED · ${fmt(rows.length)} interval · ${fmt(app.assaysByHole.size)} ID bor · sumber gabungan dua CSV assay`;
    if(els('assayLogStatus'))els('assayLogStatus').textContent='SIAP';
    if(app.selectedCollar)updateCollarDetails(app.selectedCollar);
  }catch(err){
    app.assayLoadError=err.message||'Gagal memuat data assay.';
    if(status)status.textContent='ERROR · '+app.assayLoadError;
    if(els('assayLogStatus'))els('assayLogStatus').textContent='ERROR';
    if(app.selectedCollar)updateCollarDetails(app.selectedCollar);
    toast('Data assay gagal dimuat: '+app.assayLoadError);
  }
}
const lithologyColors={
  'OVBN':'#9b7867','OVBD':'#846351','OB':'#8b715e','WASTE':'#7b8b95','LIMO':'#d3ad4e','LIM':'#c8a14a',
  'SAPR':'#6fbb8d','SAP':'#8cc6a4','RSAP':'#39aaa1','R.SAP':'#39aaa1','SROC':'#6689b5','S.ROC':'#6689b5',
  'TRMT':'#a681b8','BRK':'#777f8a','WBRK':'#a0a8b1','BLD':'#c3cbd0','TS':'#c8ae83','SOIL':'#c8ae83','S.ROC':'#6689b5'
};
const lithologyPalette=['#d5a751','#70b7a1','#7ca4d8','#c987a3','#a8bc6b','#bb9ade','#dc875d','#79c6cb','#b5ad86','#8f9cbd','#d49a7a','#91b88e'];
function lithologyColor(name){
  const raw=String(name||'Tidak diketahui').trim().toUpperCase();
  const key=raw.replace(/[^A-Z0-9.]/g,'');
  if(lithologyColors[key])return lithologyColors[key];
  let h=0;for(let i=0;i<raw.length;i++)h=(h*31+raw.charCodeAt(i))>>>0;
  return lithologyPalette[h%lithologyPalette.length];
}
function assayWeighted(rows,key){
  let n=0,d=0;
  for(const r of rows){const w=Math.max(0,Number(r.to)-Number(r.from));const v=r[key];if(Number.isFinite(v)&&w>0){n+=w*v;d+=w}}
  return d>0?n/d:null;
}
function latestBlockTopNearCollar(c){
  if(!c||!app.rows.length)return null;
  let best=null,bestD2=Infinity;
  for(const r of app.rows){const dx=r.x-c.x,dy=r.y-c.y,d2=dx*dx+dy*dy;if(d2<bestD2){bestD2=d2;best=r}}
  if(!best)return null;
  const maxD=Math.max(DX,DY)*1.75;if(bestD2>maxD*maxD)return {tooFar:true,distance:Math.sqrt(bestD2)};
  const topZ=(app.columnTopByKey.get(columnKey(best))??best.z)+DZ/2;
  return {topZ,depth:Number(c.z)-topZ,distance:Math.sqrt(bestD2),x:best.x,y:best.y,block:best};
}
function showAssayLogForSelected(){
  const c=app.selectedCollar;
  if(!c){toast('Pilih satu titik collar terlebih dahulu.');return}
  const panel=els('assayLogCard');panel.classList.remove('hidden');
  app.assayCurrentHole=normalizeHoleId(c.id);
  els('assayLogHeading').innerHTML=`${escapeHtml(c.id)}<small>RL collar ${fmt(c.z,3)} m · kedalaman collar ${Number.isFinite(Number(c.depth))?fmt(Number(c.depth),2)+' m':'—'} · model berdasarkan interval assay/litologi</small>`;
  const rows=app.assaysByHole.get(app.assayCurrentHole)||[];
  if(!app.assayLoaded){
    els('assayLogStatus').textContent='BELUM SIAP';
    els('assayLogMessage').textContent=app.assayLoadError||'Data assay masih dimuat. Tunggu sampai status LOADED.';
    els('assayLogStats').innerHTML='';els('assayProfile').className='assay-profile-empty';els('assayProfile').textContent='Profil belum dapat dibuat.';els('assayLegend').innerHTML='';
    els('assayIntervalBody').innerHTML='<tr><td colspan="9" class="table-empty">Assay belum dimuat.</td></tr>';
  }else if(!rows.length){
    els('assayLogStatus').textContent='TIDAK ADA ASSAY';
    els('assayLogMessage').textContent='ID collar ini tidak ditemukan di kedua sumber assay yang dilampirkan.';
    els('assayLogStats').innerHTML='';els('assayProfile').className='assay-profile-empty';els('assayProfile').textContent='Tidak ada interval untuk titik bor ini.';els('assayLegend').innerHTML='';
    els('assayIntervalBody').innerHTML='<tr><td colspan="9" class="table-empty">Data assay tidak tersedia.</td></tr>';
  }else{
    els('assayLogStatus').textContent=`${fmt(rows.length)} INTERVAL`;
    const maxTo=Math.max(...rows.map(r=>r.to)), minFrom=Math.min(...rows.map(r=>r.from));
    const totalLength=rows.reduce((s,r)=>s+Math.max(0,r.to-r.from),0);
    const avgNi=assayWeighted(rows,'ni'),avgFe=assayWeighted(rows,'fe');
    els('assayLogMessage').textContent=`Sumber: ${[...new Set(rows.map(r=>r.source))].join(' · ')}. Nilai Ni/Fe ringkasan adalah rata-rata berbobot panjang interval assay, bukan berbobot tonase. Interval menampilkan nilai From–To sesuai file sumber.`;
    els('assayLogStats').innerHTML=[
      ['Interval assay',fmt(rows.length)],
      ['Kedalaman data assay',`${fmt(minFrom,2)}–${fmt(maxTo,2)} m`],
      ['Ni berbobot interval',avgNi===null?'—':`${fmt(avgNi,3)}%`],
      ['Fe berbobot interval',avgFe===null?'—':`${fmt(avgFe,2)}%`]
    ].map(([label,value])=>`<div class="assay-stat"><span>${label}</span><b>${value}</b></div>`).join('');
    const modelBoundary=latestBlockTopNearCollar(c);
    const maxDepth=Math.max(1,maxTo,modelBoundary&&!modelBoundary.tooFar&&modelBoundary.depth>0?modelBoundary.depth:0),profileHeight=Math.max(180,Math.min(520,maxDepth*5)),scale=profileHeight/maxDepth;
    const tickEvery=maxDepth<=30?5:(maxDepth<=70?10:20);
    const ticks=[];for(let d=0;d<=maxDepth;d+=tickEvery)ticks.push(d);if(ticks[ticks.length-1]!==maxDepth)ticks.push(maxDepth);
    const axis=ticks.map(d=>`<span class="assay-depth-tick" style="top:${Math.min(profileHeight,Math.max(0,d*scale))}px">${fmt(d,0)}</span>`).join('');
    const grid=ticks.map(d=>`<span class="assay-track-tick" style="top:${Math.min(profileHeight,Math.max(0,d*scale))}px"></span>`).join('');
    const segments=rows.map((r,i)=>{
      const top=Math.max(0,Math.min(profileHeight,r.from*scale)),height=Math.max(2,Math.min(profileHeight-top,(r.to-r.from)*scale));
      const label=height>=16?`<span>${escapeHtml(String(r.lithology).toUpperCase())}</span>`:'';
      const color=lithologyColor(r.lithology);
      return `<div class="assay-lith-segment" data-assay-row="${i}" style="top:${top}px;height:${height}px;background:${color}" title="${escapeHtml(`${r.from.toFixed(2)}–${r.to.toFixed(2)} m · ${r.lithology} · Zona ${r.zona||'—'} · Ni ${r.ni===null?'—':r.ni}% · Fe ${r.fe===null?'—':r.fe}%`)}">${label}</div>`;
    }).join('');
    els('assayProfile').className='assay-profile-scroll';
    const boundaryMarkup=modelBoundary&&!modelBoundary.tooFar?`<div class="assay-current-model-boundary" style="top:${Math.max(0,Math.min(profileHeight,modelBoundary.depth*scale))}px" data-label="TOP CSV ${modelBoundary.topZ.toFixed(1)} m" title="Batas atas block model terbaru; elevasi ${modelBoundary.topZ.toFixed(2)} m, jarak horizontal ${modelBoundary.distance.toFixed(1)} m"></div>`:'';
    const boundaryNote=!app.rows.length?'<div class="assay-profile-boundary-note">CSV block model belum dimuat; batas elevasi belum tersedia.</div>':!modelBoundary?'<div class="assay-profile-boundary-note">Batas block model belum dapat dihitung.</div>':modelBoundary.tooFar?`<div class="assay-profile-boundary-note">Tidak ditemukan blok cukup dekat dengan collar ini (blok terdekat ${modelBoundary.distance.toFixed(1)} m); garis batas tidak ditampilkan agar tidak menyesatkan.</div>`:`<div class="assay-profile-boundary-note">━ Garis hijau: batas atas block model CSV terbaru · RL ${modelBoundary.topZ.toFixed(2)} m · ${modelBoundary.depth>=0?modelBoundary.depth.toFixed(2)+' m di bawah collar':Math.abs(modelBoundary.depth).toFixed(2)+' m di atas collar'}.</div>`;
    els('assayProfile').innerHTML=`<div class="assay-profile-layout" style="height:${profileHeight}px"><div class="assay-depth-axis" style="height:${profileHeight}px">${axis}</div><div class="assay-lithology-track" style="height:${profileHeight}px">${grid}${segments}${boundaryMarkup}</div></div><div class="subtext" style="margin-top:6px">Kedalaman 0 m berada di bagian atas; interval yang tidak ada pada file sumber tidak diisi otomatis.</div>${boundaryNote}`;
    const lCounts=new Map();for(const r of rows){const key=String(r.lithology||'Tidak diketahui').trim().toUpperCase()||'TIDAK DIKETAHUI';lCounts.set(key,(lCounts.get(key)||0)+1)}
    els('assayLegend').innerHTML=[...lCounts.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=>`<span class="assay-legend-item"><span class="assay-legend-swatch" style="background:${lithologyColor(name)}"></span>${escapeHtml(name)} <b>${fmt(count)}</b></span>`).join('');
    els('assayIntervalBody').innerHTML=rows.map((r,i)=>`<tr data-assay-row="${i}"><td>${fmt(r.from,2)}</td><td>${fmt(r.to,2)}</td><td>${fmt(r.interval,2)}</td><td><span class="assay-legend-swatch" style="display:inline-block;vertical-align:middle;margin-right:5px;background:${lithologyColor(r.lithology)}"></span>${escapeHtml(r.lithology)}</td><td>${escapeHtml(r.zona||'—')}</td><td>${r.ni===null?'—':fmt(r.ni,3)}</td><td>${r.fe===null?'—':fmt(r.fe,2)}</td><td>${r.sio2===null?'—':fmt(r.sio2,2)}</td><td>${r.mgo===null?'—':fmt(r.mgo,2)}</td></tr>`).join('');
  }
  const b=els('viewAssayBtn');if(b)b.setAttribute('aria-expanded','true');
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function updateCollarDetails(c){
  const box=els('collarSelectedInfo');if(!box)return;
  if(!c){
    closeAssayLog();
    box.innerHTML='<div class="hole-name">Belum ada titik dipilih</div><div class="hole-meta">Klik titik collar pada peta atau cari ID untuk melihat koordinat, elevasi, dan kedalaman lubang.</div>';
    return;
  }
  const outside=!collarInsideOrtho(c),depth=(c.depth===null||c.depth===undefined||!Number.isFinite(Number(c.depth)))?'—':fmt(Number(c.depth),2)+' m';
  const samples=app.assaysByHole.get(normalizeHoleId(c.id))||[];
  const assayHint=app.assayLoaded?(samples.length?`${fmt(samples.length)} interval assay tersedia.`:'Belum ada interval assay untuk ID ini.'):(app.assayLoadError?'Data assay gagal dimuat.':'Data assay sedang dimuat…');
  const disabled=(!app.assayLoaded&&!app.assayLoadError)?'disabled':'';
  const label=app.assayLoaded?'Lihat log litologi & assay':(app.assayLoadError?'Cek status assay':'Memuat data assay…');
  box.innerHTML=`<div class="hole-name">${escapeHtml(c.id)}</div><div class="hole-meta">X / Easting: ${fmt(c.x,3)} m<br>Y / Northing: ${fmt(c.y,3)} m<br>Z / RL collar: ${fmt(c.z,3)} m<br>Depth collar: ${depth}<br>Sumber collar: ${escapeHtml(c.source||app.collarName)}<br>${outside?'Di luar footprint ortofoto':'Di dalam footprint ortofoto'}</div><div class="assay-view-row"><button class="primary" id="viewAssayBtn" type="button" ${disabled} aria-expanded="false">Lihat log litologi & assay</button></div><div class="assay-view-hint">${escapeHtml(assayHint)} Profil hanya dibuka jika tombol ditekan.</div>`;
  const b=els('viewAssayBtn');if(b)b.textContent=label;
}
function selectCollar(c,focus=false){
  if(!c)return;closeAssayLog();app.selectedCollar=c;els('collarSearch').value=c.id;updateCollarDetails(c);
  if(focus){app.centerX=c.x;app.centerY=c.y;app.scale=Math.max(app.scale,1.0);app.viewTouched=true;canvasSize()}
  draw();
}
function searchCollar(){
  const q=String(els('collarSearch').value||'').trim().toUpperCase();
  if(!q){toast('Masukkan ID collar terlebih dahulu.');return}
  if(!app.collars.length){toast('Data collar belum dimuat.');return}
  const found=app.collars.find(c=>c.id.toUpperCase()===q)||app.collars.find(c=>c.id.toUpperCase().includes(q));
  if(!found){toast(`ID collar "${q}" tidak ditemukan.`);return}
  selectCollar(found,true);toast(`Menampilkan ${found.id}${collarInsideOrtho(found)?'':' · titik berada di luar ortofoto'}.`);
}
function fitCollarData(){
  if(!app.collarBounds){toast('Data collar belum dimuat.');return}
  const b=app.collarBounds,rect=canvas.getBoundingClientRect();
  app.viewW=Math.max(1,rect.width||canvas.clientWidth||900);app.viewH=Math.max(1,rect.height||canvas.clientHeight||600);
  const w=Math.max(1,b.maxX-b.minX),h=Math.max(1,b.maxY-b.minY);
  app.centerX=(b.minX+b.maxX)/2;app.centerY=(b.minY+b.maxY)/2;
  app.scale=Math.max(.02,Math.min(8,Math.min((app.viewW-60)/w,(app.viewH-60)/h)));
  app.viewTouched=true;canvasSize();draw();toast('Tampilan disesuaikan ke seluruh titik collar.');
}
function syncCollarToggleUI(){
  const b=els('collarsToggle'),l=els('collarLabelsToggle');
  if(b){b.classList.toggle('active',!!app.showCollars);b.textContent=app.showCollars?'Sembunyikan collar':'Tampilkan collar';b.setAttribute('aria-pressed',String(!!app.showCollars))}
  if(l){l.classList.toggle('active',!!app.showCollarLabels);l.textContent=app.showCollarLabels?'ID bor ✓':'ID bor ×';l.setAttribute('aria-pressed',String(!!app.showCollarLabels))}
}
function loadCollarsUrl(){
  let saved=null;try{saved=JSON.parse(localStorage.getItem(COLLAR_STORAGE_KEY)||'null')}catch(e){}
  if(saved&&Array.isArray(saved.rows)&&saved.rows.length){
    const rows=saved.rows.filter(c=>c&&Number.isFinite(Number(c.x))&&Number.isFinite(Number(c.y))&&Number.isFinite(Number(c.z))).map(c=>({id:String(c.id||''),x:Number(c.x),y:Number(c.y),z:Number(c.z),depth:(c.depth===null||c.depth===undefined||c.depth===''?null:Number(c.depth)),source:String(c.source||saved.name||'collars.csv')}));
    loadCollars(rows,saved.name||'Data collar tersimpan',false);return;
  }
  if(location.protocol==='file:'){els('collarStatus').textContent='PILIH CSV';els('collarLoadNote').textContent='Buka launcher atau muat CSV collar secara manual.';return}
  fetch('./collars.csv').then(r=>{if(!r.ok)throw new Error('collars.csv tidak ditemukan (HTTP '+r.status+')');return r.text()}).then(t=>loadCollars(parseCollarCSV(t,'collars.csv'),'collars.csv')).catch(e=>{els('collarStatus').textContent='ERROR';els('collarLoadNote').textContent=e.message;toast('Data collar gagal dimuat. Pilih CSV collar secara manual.')});
}
function findNearestCollarAtScreen(x,y,maxDist=12){
  if(!app.showCollars)return null;let best=null,bestD=maxDist;
  for(const c of app.collars){const p=worldToScreen(c.x,c.y);if(p.x<0||p.x>app.viewW||p.y<0||p.y>app.viewH)continue;const d=Math.hypot(p.x-x,p.y-y);if(d<bestD){bestD=d;best=c}}
  return best;
}
function canvasSize(){const rect=canvas.getBoundingClientRect();app.dpr=Math.min(window.devicePixelRatio||1,2);app.viewW=Math.max(1,rect.width);app.viewH=Math.max(1,rect.height);canvas.width=Math.round(app.viewW*app.dpr);canvas.height=Math.round(app.viewH*app.dpr);ctx.setTransform(app.dpr,0,0,app.dpr,0,0);draw()}
// Convert WGS84 latitude/longitude to this project's projected CRS: EPSG:32751 (UTM zone 51S).
function wgs84ToUtm51S(lat,lon){
  const a=6378137.0,eccSq=0.0066943799901413165,k0=0.9996,zone=51;
  const latRad=lat*Math.PI/180,lonRad=lon*Math.PI/180,lonOrigin=((zone-1)*6-180+3)*Math.PI/180;
  const eccPrimeSq=eccSq/(1-eccSq),sinLat=Math.sin(latRad),cosLat=Math.cos(latRad),tanLat=Math.tan(latRad);
  const N=a/Math.sqrt(1-eccSq*sinLat*sinLat),T=tanLat*tanLat,C=eccPrimeSq*cosLat*cosLat,A=cosLat*(lonRad-lonOrigin);
  const M=a*((1-eccSq/4-3*eccSq*eccSq/64-5*eccSq*eccSq*eccSq/256)*latRad-(3*eccSq/8+3*eccSq*eccSq/32+45*eccSq*eccSq*eccSq/1024)*Math.sin(2*latRad)+(15*eccSq*eccSq/256+45*eccSq*eccSq*eccSq/1024)*Math.sin(4*latRad)-(35*eccSq*eccSq*eccSq/3072)*Math.sin(6*latRad));
  const easting=500000+k0*N*(A+(1-T+C)*Math.pow(A,3)/6+(5-18*T+T*T+72*C-58*eccPrimeSq)*Math.pow(A,5)/120);
  // EPSG:32751 defines a 10,000,000 m false northing for southern UTM.
  const northing=10000000+k0*(M+N*tanLat*(A*A/2+(5-T+9*C+4*C*C)*Math.pow(A,4)/24+(61-58*T+T*T+600*C-330*eccPrimeSq)*Math.pow(A,6)/720));
  return {x:easting,y:northing};
}
function gpsStatus(text,active=false){const el=els('gpsStatusText');if(el)el.textContent=text;const dot=els('gpsLiveDot');if(dot)dot.classList.toggle('active',!!active)}
function gpsErrorMessage(error){if(!error)return'Lokasi tidak tersedia.';if(error.code===1)return'Izin lokasi ditolak. Izinkan Location untuk Mine Reserve melalui pengaturan browser.';if(error.code===2)return'Posisi tidak tersedia. Aktifkan Location/GPS di HP, pindah ke area terbuka, lalu coba lagi.';if(error.code===3)return'Waktu mencari GPS habis. Tetap di luar ruangan sebentar lalu tekan Cari posisi lagi.';return error.message||'Lokasi gagal dibaca.'}
function updateGpsCoords(){const el=els('gpsCoordsText');if(!el)return;const p=app.gpsPosition;if(!p){el.innerHTML='UTM 51S: —<br>Lat/Lon: —';return}el.innerHTML=`UTM 51S: ${fmt(p.x,1)} E · ${fmt(p.y,1)} N<br>Lat/Lon: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>Akurasi: ±${fmt(p.accuracy,0)} m${Number.isFinite(p.altitude)?` · Alt: ${fmt(p.altitude,1)} m`:''}`}
function acceptGpsPosition(position,follow){const c=position.coords;if(!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude))return;const utm=wgs84ToUtm51S(c.latitude,c.longitude);app.gpsPosition={lat:c.latitude,lon:c.longitude,x:utm.x,y:utm.y,accuracy:Number.isFinite(c.accuracy)?Math.max(0,c.accuracy):25,altitude:Number.isFinite(c.altitude)?c.altitude:null,heading:Number.isFinite(c.heading)?c.heading:null,speed:Number.isFinite(c.speed)?c.speed:null,timestamp:position.timestamp||Date.now()};
  const withinZone=c.longitude>=120&&c.longitude<=126&&c.latitude<0;
  const withinRaster=utm.x>=rasterBounds.minX&&utm.x<=rasterBounds.maxX&&utm.y>=rasterBounds.minY&&utm.y<=rasterBounds.maxY;
  const age=Math.max(0,Math.round((Date.now()-app.gpsPosition.timestamp)/1000));
  let status=`GPS terdeteksi · akurasi ±${fmt(app.gpsPosition.accuracy,0)} m · ${new Date(app.gpsPosition.timestamp).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}.`;
  if(!withinZone)status+=' Lokasi di luar zona UTM 51S; posisi pada peta mungkin tidak sesuai CRS proyek.';
  else if(!withinRaster)status+=' Posisi berada di luar cakupan ortofoto proyek.';
  if(app.gpsFollowing&&follow){app.centerX=utm.x;app.centerY=utm.y;if(!app.gpsFirstWatchFix){app.scale=Math.max(app.scale,0.8);app.gpsFirstWatchFix=true}app.viewTouched=true;}
  updateGpsCoords();gpsStatus(status,true);draw();
}
function focusGps(){if(!app.gpsPosition){startGpsLocate();return}app.centerX=app.gpsPosition.x;app.centerY=app.gpsPosition.y;app.scale=Math.max(app.scale,0.8);app.viewTouched=true;canvasSize();draw();toast('Peta dipusatkan ke posisi GPS terakhir.');}
function startGpsLocate(){
  if(!navigator.geolocation){gpsStatus('Browser/perangkat ini tidak menyediakan layanan lokasi.');toast('Layanan GPS tidak tersedia pada browser ini.');return}
  if(!window.isSecureContext&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){gpsStatus('GPS membutuhkan alamat HTTPS atau localhost.');toast('Aktifkan GPS melalui link HTTPS untuk menggunakan lokasi HP.');return}
  gpsStatus('Mencari lokasi terkini… Aktifkan izin lokasi dan tunggu beberapa saat.');
  navigator.geolocation.getCurrentPosition(pos=>{acceptGpsPosition(pos,false);focusGps()},err=>{gpsStatus(gpsErrorMessage(err),false);toast(gpsErrorMessage(err))},{enableHighAccuracy:true,maximumAge:5000,timeout:45000});
}
function toggleGpsFollow(){
  if(app.gpsWatchId!==null){navigator.geolocation.clearWatch(app.gpsWatchId);app.gpsWatchId=null;app.gpsFollowing=false;app.gpsFirstWatchFix=false;els('gpsFollowBtn').textContent='Aktifkan GPS';els('gpsFollowBtn').classList.remove('active');gpsStatus(app.gpsPosition?'GPS nonaktif · posisi terakhir tetap ditampilkan.':'GPS nonaktif.',!!app.gpsPosition);toast('Pelacakan GPS dinonaktifkan.');return}
  if(!navigator.geolocation){gpsStatus('Browser/perangkat tidak mendukung GPS.');toast('Layanan GPS tidak tersedia.');return}
  if(!window.isSecureContext&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){gpsStatus('GPS membutuhkan alamat HTTPS atau localhost.');toast('Untuk HP, buka aplikasi dari link HTTPS.');return}
  app.gpsFollowing=true;app.gpsFirstWatchFix=false;els('gpsFollowBtn').textContent='Nonaktifkan GPS';els('gpsFollowBtn').classList.add('active');gpsStatus('Mengikuti GPS… peta akan mengikuti posisi Anda saat bergerak.');
  app.gpsWatchId=navigator.geolocation.watchPosition(pos=>acceptGpsPosition(pos,true),err=>{const message=gpsErrorMessage(err);gpsStatus(message,!!app.gpsPosition);toast(message);if(err.code===1){navigator.geolocation.clearWatch(app.gpsWatchId);app.gpsWatchId=null;app.gpsFollowing=false;els('gpsFollowBtn').textContent='Aktifkan GPS';els('gpsFollowBtn').classList.remove('active')}},{enableHighAccuracy:true,maximumAge:3000,timeout:45000});
}
window.addEventListener('pagehide',()=>{if(app.gpsWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(app.gpsWatchId);app.gpsWatchId=null;app.gpsFollowing=false}});
function drawGpsOnCanvas(){const g=app.gpsPosition;if(!g)return;const p=worldToScreen(g.x,g.y);if(p.x < -app.viewW||p.x>2*app.viewW||p.y < -app.viewH||p.y>2*app.viewH)return;ctx.save();ctx.globalAlpha=.95;const accuracyPx=Math.max(5,Math.min(g.accuracy*app.scale,Math.max(app.viewW,app.viewH)*1.4));ctx.beginPath();ctx.arc(p.x,p.y,accuracyPx,0,Math.PI*2);ctx.fillStyle='#2da8ff18';ctx.fill();ctx.strokeStyle='#42b5ff99';ctx.lineWidth=1.5;ctx.stroke();ctx.globalAlpha=1;
  // Crosshair, white halo, and blue GNSS position dot.
  ctx.strokeStyle='#e9f7ff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x-12,p.y);ctx.lineTo(p.x-5,p.y);ctx.moveTo(p.x+5,p.y);ctx.lineTo(p.x+12,p.y);ctx.moveTo(p.x,p.y-12);ctx.lineTo(p.x,p.y-5);ctx.moveTo(p.x,p.y+5);ctx.lineTo(p.x,p.y+12);ctx.stroke();ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.fillStyle='#f6fbff';ctx.fill();ctx.beginPath();ctx.arc(p.x,p.y,4.5,0,Math.PI*2);ctx.fillStyle='#168df0';ctx.fill();ctx.strokeStyle='#064f92';ctx.lineWidth=1;ctx.stroke();
  if(p.x>=0&&p.x<=app.viewW&&p.y>=0&&p.y<=app.viewH){const label=`POSISI SAYA ±${fmt(g.accuracy,0)} m`;ctx.font='bold 10px ui-sans-serif,system-ui';const tw=ctx.measureText(label).width;const bx=Math.max(4,Math.min(app.viewW-tw-16,p.x+12)),by=Math.max(18,Math.min(app.viewH-8,p.y-13));ctx.fillStyle='#08243aeb';ctx.strokeStyle='#44b8ff';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(bx-4,by-11,tw+12,17,5);ctx.fill();ctx.stroke();ctx.fillStyle='#e5f6ff';ctx.fillText(label,bx+2,by)}ctx.restore();
}
function worldToScreen(x,y){return {x:app.viewW/2+(x-app.centerX)*app.scale,y:app.viewH/2-(y-app.centerY)*app.scale}}
function screenToWorld(px,py){return {x:app.centerX+(px-app.viewW/2)/app.scale,y:app.centerY-(py-app.viewH/2)/app.scale}}
function positionRasterLayer(){const img=app.raster;if(!img)return;if(!app.showOrtho||!app.rasterReady){img.style.display='none';return}const p=worldToScreen(rasterBounds.minX,rasterBounds.maxY);img.style.left=`${p.x}px`;img.style.top=`${p.y}px`;img.style.width=`${(rasterBounds.maxX-rasterBounds.minX)*app.scale}px`;img.style.height=`${(rasterBounds.maxY-rasterBounds.minY)*app.scale}px`;img.style.display='block'}
function fitData(){
  // Refresh the canvas dimensions before fitting. This avoids stale viewport sizes
  // when the browser starts, the mobile display rotates, or the sidebar reflows.
  const rect=canvas.getBoundingClientRect();
  app.viewW=Math.max(1,rect.width||canvas.clientWidth||900);
  app.viewH=Math.max(1,rect.height||canvas.clientHeight||600);
  const b=app.allBounds||rasterBounds;
  const minX=Math.min(b.minX,rasterBounds.minX),maxX=Math.max(b.maxX,rasterBounds.maxX);
  const minY=Math.min(b.minY,rasterBounds.minY),maxY=Math.max(b.maxY,rasterBounds.maxY);
  const w=Math.max(1,maxX-minX),h=Math.max(1,maxY-minY);
  app.centerX=(minX+maxX)/2;app.centerY=(minY+maxY)/2;
  const fitted=Math.min((app.viewW-56)/w,(app.viewH-56)/h);
  app.scale=Math.max(.015,Math.min(8,fitted));
  // Draw again on the next frame as well: some Windows browsers resize the canvas
  // immediately after the first paint and would otherwise leave a stale/blank view.
  canvasSize();draw();saveProjectState();
} 
function zoomAt(f,x=app.viewW/2,y=app.viewH/2){app.viewTouched=true;const pre=screenToWorld(x,y);app.scale=Math.max(.025,Math.min(8,app.scale*f));const post=screenToWorld(x,y);app.centerX+=pre.x-post.x;app.centerY+=pre.y-post.y;draw();saveProjectState()}
function polygonArea(poly){let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p.x*q.y-q.x*p.y}return Math.abs(a/2)}
function signedArea(poly){let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p.x*q.y-q.x*p.y}return a/2}
function offsetPolygon(poly,d){if(poly.length<3||d<=0)return poly.map(p=>({...p}));const orientation=signedArea(poly)>=0?1:-1;const normals=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy)||1;normals.push(orientation>0?{x:dy/len,y:-dx/len}:{x:-dy/len,y:dx/len})}const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],n1=normals[(i-1+poly.length)%poly.length],n2=normals[i];const sx=n1.x+n2.x,sy=n1.y+n2.y,dot=sx*n2.x+sy*n2.y;let k=Math.abs(dot)>1e-6?d/dot:d;let ox=sx*k,oy=sy*k;const m=Math.hypot(ox,oy);const cap=Math.max(d*4,d+2);if(m>cap){ox*=cap/m;oy*=cap/m}out.push({x:p.x+ox,y:p.y+oy})}return out}
function pointInPoly(x,y,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(distSeg(x,y,a,b)<=1e-7)return true;if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))inside=!inside;}return inside;}
function distSeg(px,py,a,b){const dx=b.x-a.x,dy=b.y-a.y;const den=dx*dx+dy*dy;const t=den?Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/den)):0;const x=a.x+t*dx,y=a.y+t*dy;return Math.hypot(px-x,py-y)}
function distanceToPoly(px,py,poly){if(pointInPoly(px,py,poly))return 0;let d=Infinity;for(let i=0;i<poly.length;i++)d=Math.min(d,distSeg(px,py,poly[i],poly[(i+1)%poly.length]));return d}
function columnKey(r){return `${Number(r.x).toFixed(4)}|${Number(r.y).toFixed(4)}`}
function buildColumnTopIndex(rows){const m=new Map();for(const r of rows){const k=columnKey(r);const prev=m.get(k);if(prev===undefined||r.z>prev)m.set(k,r.z)}return m}
function findAutoTopRL(poly){let minTop=Infinity,maxTop=-Infinity,count=0;const seen=new Set();for(const r of app.rows){if(!pointInPoly(r.x,r.y,poly))continue;const k=columnKey(r);if(seen.has(k))continue;seen.add(k);const topZ=app.columnTopByKey.get(k);if(!Number.isFinite(topZ))continue;const rl=topZ+DZ/2;count++;minTop=Math.min(minTop,rl);maxTop=Math.max(maxTop,rl)}return count?{minTop,maxTop,count,columns:count}:null}
function updateAutoLevelPreview(){const depth=Math.max(1,Math.round(Number(els('cutDepth').value)||1));const found=app.floorPoly.length>=3&&app.rows.length?findAutoTopRL(app.floorPoly):null;if(found){els('statTopRL').innerHTML=`${fmt(found.minTop,1)}–${fmt(found.maxTop,1)} <span class="unit">RL</span>`;els('statTargetRL').innerHTML=`${fmt(found.minTop-depth,1)}–${fmt(found.maxTop-depth,1)} <span class="unit">RL</span>`;els('statHeight').innerHTML=`${fmt(depth,0)} <span class="unit">m</span>`;els('statRun').innerHTML=`${fmt(depth/TAN_SLOPE,2)} <span class="unit">m</span>`;els('formulaCalc').textContent=`${fmt(found.columns)} kolom XY; RL top lokal ${fmt(found.minTop,1)}–${fmt(found.maxTop,1)}; RL target lokal dikurangi ${fmt(depth)} m.`}else{els('statTopRL').innerHTML=`— <span class="unit">RL</span>`;els('statTargetRL').innerHTML=`— <span class="unit">RL</span>`;els('statHeight').innerHTML=`${fmt(depth,0)} <span class="unit">m</span>`;els('statRun').innerHTML=`${fmt(depth/TAN_SLOPE,2)} <span class="unit">m</span>`;els('formulaCalc').textContent=app.floorPoly.length>=3?'Tidak ada pusat block di dalam polygon. Perbesar atau sesuaikan polygon.':'Gambar polygon untuk membaca level Z per kolom.'}return found}
function calculateDesign(){
 if(app.floorPoly.length<3){toast('Gambar polygon terlebih dahulu.');return}
 if(!app.rows.length){toast('CSV block model belum dimuat.');return}
 const depth=Math.max(1,Math.round(Number(els('cutDepth').value)||1));els('cutDepth').value=String(depth);app.cutDepth=depth;app.selectionMode=els('selectionMode').value||'layer';
 const found=findAutoTopRL(app.floorPoly);
 if(!found){updatePolygonStageSummary();toast('Tidak ada pusat block di dalam polygon. Gambar polygon sedikit lebih besar hingga mencakup pusat block.');return}
 const run=depth/TAN_SLOPE,mode=app.selectionMode;
 const floorMin=found.minTop-depth,floorMax=found.maxTop-depth;
 app.topRL={min:found.minTop,max:found.maxTop};app.crestPoly=offsetPolygon(app.floorPoly,run);app.designApplied=true;app.selected=new Uint8Array(app.rows.length);saveProjectState();
 let count=0,vol=0,tonnes=0,niSum=0,feSum=0;const byClass={};
 for(let i=0;i<app.rows.length;i++){
  const r=app.rows[i],topZ=app.columnTopByKey.get(columnKey(r));if(!Number.isFinite(topZ))continue;
  // Each XY column has its own top Z, already clipped by the user's topo update.
  const inVertical=mode==='cumulative'?(r.z<=topZ+1e-6&&r.z>=topZ-(depth-1)*DZ-1e-6):(Math.abs(r.z-(topZ-(depth-1)*DZ))<1e-3);
  if(!inVertical)continue;
  // Footprint is the planned lower pit floor. Expand allowed distance upslope using the 60-degree geometry and local column top.
  const localFloorRL=topZ+DZ/2-depth;
  const allowedDistance=Math.max(0,(r.z+DZ/2-localFloorRL)/TAN_SLOPE);
  if(distanceToPoly(r.x,r.y,app.floorPoly)>allowedDistance+1e-6)continue;
  app.selected[i]=1;count++;const t=BLOCK_VOL*r.density;vol+=BLOCK_VOL;tonnes+=t;niSum+=t*r.ni;feSum+=t*r.fe;byClass[r.cls]=(byClass[r.cls]||0)+1;
 }
 const avgNi=tonnes?niSum/tonnes:0,avgFe=tonnes?feSum/tonnes:0;
 app.stats={count,vol,tonnes,avgNi,avgFe,byClass,height:depth,run,floor:floorMin,floorMax,crest:found.maxTop,crestMin:found.minTop,topRL:found.maxTop,topRLMin:found.minTop,depth,mode};
 els('statBlocks').textContent=fmt(count);els('statVolume').innerHTML=`${fmt(vol)} <span class="unit">m³</span>`;els('statTonnes').innerHTML=`${fmt(tonnes)} <span class="unit">t</span>`;els('statNi').innerHTML=`${fmt(avgNi,2)} <span class="unit">%</span>`;
 els('summaryTag').textContent=mode==='layer'?`LAPISAN ${fmt(depth)} M`:`AKUMULASI ${fmt(depth)} M`;
 els('statTopRL').innerHTML=`${fmt(found.minTop,1)}–${fmt(found.maxTop,1)} <span class="unit">RL</span>`;els('statTargetRL').innerHTML=`${fmt(floorMin,1)}–${fmt(floorMax,1)} <span class="unit">RL</span>`;els('statHeight').innerHTML=`${fmt(depth,0)} <span class="unit">m</span>`;els('statRun').innerHTML=`${fmt(run,2)} <span class="unit">m</span>`;
 els('formulaCalc').textContent=`${fmt(found.columns)} kolom XY; RL target tiap kolom = RL top lokal − ${fmt(depth)} m; offset 60° maksimum ${fmt(run,2)} m.`;
 els('summaryNote').textContent=`${mode==='layer'?'Lapisan tahap '+depth+' m relatif ke permukaan tiap kolom':'Akumulasi top '+depth+' m pada setiap kolom'}: ${fmt(count)} block; volume ${fmt(vol,2)} m³; rata-rata Ni berbobot ${fmt(avgNi,2)}%; Fe ${fmt(avgFe,2)}%.`;
 els('exportStageBtn').disabled=count===0;renderBreakdown(byClass,true);updateAutoLevelPreview();updatePolyStatus();updatePolygonStageSummary();draw();
 els('envelopeResult').textContent=`Termasuk envelope: ${fmt(count)} block · ${fmt(tonnes,2)} t. Ringkasan Results memakai polygon saja.`;
 toast(count?`Polygon: ${fmt(app.polyStageSummary?.count||0)} block · dengan envelope: ${fmt(count)} block.`:'Tidak ada block pada tahap/area ini. Periksa polygon atau kedalaman.');
}
function exportSelectedCsv(){if(!app.designApplied||!app.stats||!app.stats.count){toast('Hitung tahap yang memiliki block terlebih dahulu.');return}
 const header=['X','Y','Z','source_product_class','material_class','Ni_percent','Fe_percent','density_t_m3','block_volume_m3','block_tonnage_t','initial_RL_m','target_RL_m','depth_stage_m','selection_mode'];
 const quote=v=>{const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};const lines=[header.join(',')];
 for(let i=0;i<app.rows.length;i++){if(!app.selected[i])continue;const r=app.rows[i];lines.push([r.x,r.y,r.z,r.sourceCls,r.cls,r.ni,r.fe,r.density,BLOCK_VOL,BLOCK_VOL*r.density,(app.columnTopByKey.get(columnKey(r))+DZ/2),(app.columnTopByKey.get(columnKey(r))+DZ/2-app.stats.depth),app.stats.depth,app.stats.mode].map(quote).join(','))}
 const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`Mine_Reserve_tahap_${app.stats.depth}m_${app.stats.mode}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('CSV hasil tahap sudah disiapkan untuk diunduh.');
}
function renderBreakdown(byClass,selected){const box=els('classBreakdown');box.innerHTML='';const counts={};if(selected){for(const k of classOrder)counts[k]=byClass[k]||0;for(const [k,v] of Object.entries(byClass))if(counts[k]===undefined)counts[k]=v}else{for(const r of app.rows)counts[r.cls]=(counts[r.cls]||0)+1}for(const cls of Object.keys(counts).filter(k=>counts[k]>0).sort((a,b)=>(classOrder.indexOf(a)<0?99:classOrder.indexOf(a))-(classOrder.indexOf(b)<0?99:classOrder.indexOf(b)))){const d=document.createElement('div');d.className='class-chip';d.innerHTML=`<span><i class="swatch" style="display:inline-block;background:${colors[cls]||'#c5b3f5'};vertical-align:middle;margin-right:4px"></i>${escapeHtml(cls)}</span><b>${fmt(counts[cls])}</b>`;box.append(d)}}
function updatePolygonStageSummary(){
 const depth=Math.max(1,Math.round(Number(els('cutDepth').value)||1));
 const mode=els('selectionMode').value||'layer';
 const reset=()=>{
  els('summaryTag').textContent='BELUM ADA POLYGON';
  els('statBlocks').textContent='—';
  els('statVolume').innerHTML='— <span class="unit">m³</span>';
  els('statTonnes').innerHTML='— <span class="unit">t</span>';
  els('statNi').innerHTML='— <span class="unit">%</span>';
  els('statFe').innerHTML='— <span class="unit">%</span>';
  els('statSR').textContent='—';
  els('classBreakdown').innerHTML='';
  els('polygonStageObSapBody').innerHTML='<tr><td colspan="6" class="table-empty">Gambar polygon untuk melihat OB/Saprolit pada tahap terpilih.</td></tr>';
  els('summaryNote').textContent='Gambar polygon untuk menghitung ringkasan tahap di dalam polygon; ringkasan total semua elevasi tersedia di bawah.';
  els('exportPolygonStageSummaryBtn').disabled=true;
  els('exportPolygonStageBlocksBtn').disabled=true;
  app.polyStageSummary=null;app.polygonStageRowIndices=[];
 };
 if(!app.rows.length||app.floorPoly.length<3){reset();return null;}
 const groups={
  OB:{label:'Di bawah cut-off · Ni < 1,20%',count:0,vol:0,tonnes:0,niMass:0,feMass:0},
  Saprolit:{label:'Di atas cut-off · Ni ≥ 1,20%',count:0,vol:0,tonnes:0,niMass:0,feMass:0}
 };
 const byClass={},indices=[];let count=0,vol=0,tonnes=0,niMass=0,feMass=0;
 for(let i=0;i<app.rows.length;i++){
  const r=app.rows[i];
  if(!pointInPoly(r.x,r.y,app.floorPoly))continue;
  const topZ=app.columnTopByKey.get(columnKey(r));if(!Number.isFinite(topZ))continue;
  const inDepth=mode==='cumulative'
   ? r.z<=topZ+1e-3 && r.z>=topZ-(depth-1)*DZ-1e-3
   : Math.abs(r.z-(topZ-(depth-1)*DZ))<1e-3;
  if(!inDepth)continue;
  indices.push(i);count++;
  const bv=BLOCK_VOL,den=(Number.isFinite(r.density)&&r.density>0)?r.density:1.65,t=bv*den;
  const ni=Number.isFinite(r.ni)?r.ni:0,fe=Number.isFinite(r.fe)?r.fe:0;
  vol+=bv;tonnes+=t;niMass+=t*ni;feMass+=t*fe;
  const cls=r.cls||r.sourceCls||'OTHER';const g=byClass[cls]||(byClass[cls]={count:0,vol:0,tonnes:0,niMass:0,feMass:0});
  g.count++;g.vol+=bv;g.tonnes+=t;g.niMass+=t*ni;g.feMass+=t*fe;
  const op=ni<1.2?groups.OB:groups.Saprolit;op.count++;op.vol+=bv;op.tonnes+=t;op.niMass+=t*ni;op.feMass+=t*fe;
 }
 for(const g of Object.values(groups)){g.avgNi=g.tonnes?g.niMass/g.tonnes:0;g.avgFe=g.tonnes?g.feMass/g.tonnes:0;}
 const avgNi=tonnes?niMass/tonnes:0,avgFe=tonnes?feMass/tonnes:0;
 const sr=groups.Saprolit.tonnes>0?groups.OB.tonnes/groups.Saprolit.tonnes:null;
 app.polygonStageRowIndices=indices;
 app.polyStageSummary={depth,mode,count,volume:vol,tonnes,avgNi,avgFe,niMass,feMass,groups,byClass,sr,indices:indices.slice()};
 els('summaryTag').textContent=`${mode==='layer'?'LAPISAN':'AKUMULASI'} ${fmt(depth)} M · ${fmt(count)} BLOCK`;
 els('statBlocks').textContent=fmt(count);
 els('statVolume').innerHTML=`${fmt(vol,2)} <span class="unit">m³</span>`;
 els('statTonnes').innerHTML=`${fmt(tonnes,2)} <span class="unit">t</span>`;
 els('statNi').innerHTML=`${count?fmt(avgNi,3):'—'} <span class="unit">%</span>`;
 els('statFe').innerHTML=`${count?fmt(avgFe,3):'—'} <span class="unit">%</span>`;
 els('statSR').textContent=sr===null?'—':`${fmt(sr,2)} : 1`;
 const stageRows=['OB','Saprolit'].map(key=>{const g=groups[key],color=key==='OB'?'#78b4f2':'#91e875';return `<tr><td><i class="swatch" style="display:inline-block;background:${color};vertical-align:middle;margin-right:6px"></i>${g.label}</td><td>${fmt(g.count)}</td><td>${fmt(g.vol,2)}</td><td>${fmt(g.tonnes,2)}</td><td>${g.tonnes?fmt(g.avgNi,3):'—'}</td><td>${g.tonnes?fmt(g.avgFe,3):'—'}</td></tr>`}).join('');
 const stageTotal=`<tr class="total-row"><td>TOTAL TAHAP POLYGON</td><td>${fmt(count)}</td><td>${fmt(vol,2)}</td><td>${fmt(tonnes,2)}</td><td>${count?fmt(avgNi,3):'—'}</td><td>${count?fmt(avgFe,3):'—'}</td></tr>`;
 els('polygonStageObSapBody').innerHTML=count?stageRows+stageTotal:'<tr><td colspan="6" class="table-empty">Tidak ada block di dalam polygon pada tahap ini.</td></tr>';
 renderBreakdown(Object.fromEntries(Object.entries(byClass).map(([k,v])=>[k,v.count])),true);
 els('summaryNote').textContent=`Hanya block dengan pusat XY di dalam polygon. Mode ${mode==='layer'?'lapisan '+depth+' m (satu lapisan 1 m pada Z lokal)':'akumulasi sampai '+depth+' m dari Z tertinggi tiap kolom'}: ${fmt(count)} block, ${fmt(vol,2)} m³, ${fmt(tonnes,2)} t; Ni ${fmt(avgNi,3)}%, Fe ${fmt(avgFe,3)}% berbobot tonase. SR = tonase OB / tonase Saprolit. Boundary crest 60° tetap ditampilkan terpisah; block di luar polygon tidak masuk ringkasan ini.`;
 els('exportPolygonStageSummaryBtn').disabled=count===0;
 els('exportPolygonStageBlocksBtn').disabled=count===0;
 return app.polyStageSummary;
}
function exportPolygonStageSummary(){
 const s=app.polyStageSummary;if(!s||!s.count){toast('Gambar polygon yang mencakup block pada tahap terpilih terlebih dahulu.');return;}
 const out=[['Record','Scope','Depth_m','Mode','Category_or_Class','Block_Count','Volume_m3','Tonnage_t','Ni_weighted_pct','Fe_weighted_pct','SR_OB_tonnes_over_Saprolit_tonnes','Weighting_Method']];
 out.push(['TOTAL_POLYGON_STAGE','POLYGON_ONLY',s.depth,s.mode,'ALL',s.count,s.volume,s.tonnes,s.avgNi,s.avgFe,'','SUMPRODUCT(tonnage,grade)/SUM(tonnage)']);
 for(const key of ['OB','Saprolit']){const g=s.groups[key];out.push(['CATEGORY','POLYGON_ONLY',s.depth,s.mode,key,g.count,g.vol,g.tonnes,g.tonnes?g.niMass/g.tonnes:0,g.tonnes?g.feMass/g.tonnes:0,'','SUMPRODUCT(tonnage,grade)/SUM(tonnage)']);}
 out.push(['SR','POLYGON_ONLY',s.depth,s.mode,'OB/Saprolit','','','','','',s.sr===null?'':s.sr,'Tonase OB / Tonase Saprolit']);
 for(const cls of Object.keys(s.byClass)){const g=s.byClass[cls];out.push(['CLASS','POLYGON_ONLY',s.depth,s.mode,cls,g.count,g.vol,g.tonnes,g.tonnes?g.niMass/g.tonnes:0,g.tonnes?g.feMass/g.tonnes:0,'','SUMPRODUCT(tonnage,grade)/SUM(tonnage)']);}
 downloadCsv('Mine_Reserve_polygon_stage_summary.csv',out);toast('Ringkasan tahap polygon diunduh.');
}
function exportPolygonStageBlocks(){
 const s=app.polyStageSummary;if(!s||!s.count){toast('Tidak ada block di dalam polygon pada tahap terpilih.');return;}
 const out=[['X','Y','Z','top_Z_center','depth_stage_m','selection_mode','source_product_class','material_class','Ni_percent','Fe_percent','density_t_m3','block_volume_m3','block_tonnage_t','polygon_scope']];
 for(const i of s.indices){const r=app.rows[i],topZ=app.columnTopByKey.get(columnKey(r)),den=(Number.isFinite(r.density)&&r.density>0)?r.density:1.65;out.push([r.x,r.y,r.z,topZ,s.depth,s.mode,r.sourceCls,r.cls,r.ni,r.fe,den,BLOCK_VOL,BLOCK_VOL*den,'XY center inside drawn polygon']);}
 downloadCsv('Mine_Reserve_polygon_stage_blocks.csv',out);toast('Block pada tahap polygon diunduh.');
}

function updatePolygonSummary(){
 const body=els('polygonClassBody'), opBody=els('polygonObSapBody');
 if(!app.rows.length||app.floorPoly.length<3){
  els('polygonSummaryTag').textContent=app.rows.length?'BELUM ADA POLYGON':'CSV BELUM DIMUAT';
  els('polyArea').innerHTML=`— <span class="unit">ha</span>`;els('polyBlocks').textContent='—';
  els('polyVolume').innerHTML=`— <span class="unit">m³</span>`;els('polyTonnes').innerHTML=`— <span class="unit">t</span>`;
  els('polyNi').innerHTML=`— <span class="unit">%</span>`;els('polyFe').innerHTML=`— <span class="unit">%</span>`;
  body.innerHTML='<tr><td colspan="6" class="table-empty">Gambar dan selesaikan polygon untuk menghitung summary.</td></tr>';
  opBody.innerHTML='<tr><td colspan="6" class="table-empty">Gambar dan selesaikan polygon untuk menghitung ringkasan OB/Saprolit.</td></tr>';
  els('obSapSR').textContent='—';els('obTonnes').innerHTML='— <span class="unit">t</span>';els('sapTonnes').innerHTML='— <span class="unit">t</span>';
  els('polySummaryNote').textContent='Summary polygon menghitung pusat block yang berada di dalam boundary. Belum ada polygon yang dipilih.';
  els('exportPolySummaryBtn').disabled=true;els('exportPolyBlocksBtn').disabled=true;els('exportObSapBtn').disabled=true;app.polySummary=null;app.polygonRowIndices=[];updatePolygonStageSummary();return null;
 }
 const area=polygonArea(app.floorPoly), rowsByClass={}, indices=[];
 const opGroups={
  OB:{label:'Di bawah cut-off · Ni < 1,20%',cutoff:'Ni < 1.20%',count:0,vol:0,tonnes:0,niMass:0,feMass:0},
  Saprolit:{label:'Di atas cut-off · Ni ≥ 1,20%',cutoff:'Ni >= 1.20%',count:0,vol:0,tonnes:0,niMass:0,feMass:0}
 };
 let count=0,vol=0,tonnes=0,niMass=0,feMass=0;const columns=new Set();
 for(let i=0;i<app.rows.length;i++){
  const r=app.rows[i];if(!pointInPoly(r.x,r.y,app.floorPoly))continue;
  indices.push(i);count++;columns.add(columnKey(r));
  const bv=BLOCK_VOL,den=(Number.isFinite(r.density)&&r.density>0)?r.density:1.65,t=bv*den;
  const ni=Number.isFinite(r.ni)?r.ni:0,fe=Number.isFinite(r.fe)?r.fe:0;
  vol+=bv;tonnes+=t;niMass+=t*ni;feMass+=t*fe;
  const cls=r.cls||r.sourceCls||'OTHER';const g=rowsByClass[cls]||(rowsByClass[cls]={count:0,vol:0,tonnes:0,niMass:0,feMass:0});
  g.count++;g.vol+=bv;g.tonnes+=t;g.niMass+=t*ni;g.feMass+=t*fe;
  const op=ni<1.2?opGroups.OB:opGroups.Saprolit;
  op.count++;op.vol+=bv;op.tonnes+=t;op.niMass+=t*ni;op.feMass+=t*fe;
 }
 const avgNi=tonnes?niMass/tonnes:0,avgFe=tonnes?feMass/tonnes:0;
 for(const g of Object.values(opGroups)){g.avgNi=g.tonnes?g.niMass/g.tonnes:0;g.avgFe=g.tonnes?g.feMass/g.tonnes:0}
 const sr=opGroups.Saprolit.tonnes>0?opGroups.OB.tonnes/opGroups.Saprolit.tonnes:null;
 app.polygonRowIndices=indices;
 app.polySummary={area,areaHa:area/10000,count,columns:columns.size,volume:vol,tonnes,avgNi,avgFe,niMass,feMass,rowsByClass,opGroups,sr,indices:indices.slice()};
 els('polygonSummaryTag').textContent=count?`${fmt(count)} BLOCK · SEMUA Z`:'0 BLOCK';
 els('polyArea').innerHTML=`${fmt(area/10000,3)} <span class="unit">ha</span>`;
 els('polyBlocks').textContent=fmt(count);els('polyVolume').innerHTML=`${fmt(vol,2)} <span class="unit">m³</span>`;
 els('polyTonnes').innerHTML=`${fmt(tonnes,2)} <span class="unit">t</span>`;els('polyNi').innerHTML=`${fmt(avgNi,3)} <span class="unit">%</span>`;els('polyFe').innerHTML=`${fmt(avgFe,3)} <span class="unit">%</span>`;
 const opRows=['OB','Saprolit'].map(key=>{const g=opGroups[key],color=key==='OB'?'#78b4f2':'#91e875';return `<tr><td><i class="swatch" style="display:inline-block;background:${color};vertical-align:middle;margin-right:6px"></i>${g.label}</td><td>${fmt(g.count)}</td><td>${fmt(g.vol,2)}</td><td>${fmt(g.tonnes,2)}</td><td>${g.tonnes?fmt(g.avgNi,3):'—'}</td><td>${g.tonnes?fmt(g.avgFe,3):'—'}</td></tr>`}).join('');
 opBody.innerHTML=count?opRows:'<tr><td colspan="6" class="table-empty">Tidak ada pusat block di dalam polygon. Perbesar atau gambar ulang polygon.</td></tr>';
 els('obTonnes').innerHTML=`${fmt(opGroups.OB.tonnes,2)} <span class="unit">t</span>`;
 els('sapTonnes').innerHTML=`${fmt(opGroups.Saprolit.tonnes,2)} <span class="unit">t</span>`;
 els('obSapSR').innerHTML=sr===null?'— <span class="unit">(tidak ada tonase Saprolit)</span>':`${fmt(sr,2)} <span class="unit">: 1</span>`;
 const keys=Object.keys(rowsByClass).sort((a,b)=>{const ai=classOrder.indexOf(a),bi=classOrder.indexOf(b);return (ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b)});
 if(!count){body.innerHTML='<tr><td colspan="6" class="table-empty">Tidak ada pusat block di dalam polygon. Perbesar atau gambar ulang polygon.</td></tr>'}
 else{
  const trs=keys.map(cls=>{const g=rowsByClass[cls],n=g.tonnes?g.niMass/g.tonnes:0,f=g.tonnes?g.feMass/g.tonnes:0;return `<tr><td><i class="swatch" style="display:inline-block;background:${colors[cls]||'#c5b3f5'};vertical-align:middle;margin-right:6px"></i>${escapeHtml(cls)}</td><td>${fmt(g.count)}</td><td>${fmt(g.vol,2)}</td><td>${fmt(g.tonnes,2)}</td><td>${fmt(n,3)}</td><td>${fmt(f,3)}</td></tr>`}).join('');
  body.innerHTML=trs+`<tr class="total-row"><td>TOTAL POLYGON</td><td>${fmt(count)}</td><td>${fmt(vol,2)}</td><td>${fmt(tonnes,2)}</td><td>${fmt(avgNi,3)}</td><td>${fmt(avgFe,3)}</td></tr>`;
 }
 els('polySummaryNote').textContent=count?`Luas geometri polygon ${fmt(area,2)} m² (${fmt(area/10000,3)} ha); ${fmt(columns.size)} kolom XY dan ${fmt(count)} block mencakup semua level Z. Seleksi memakai pusat block XY; block yang hanya terpotong sebagian oleh tepi polygon tidak dihitung parsial.`:'Polygon sudah dibuat, tetapi tidak ada pusat block yang masuk. Perbesar atau sesuaikan polygon.';
 els('exportPolySummaryBtn').disabled=count===0;els('exportPolyBlocksBtn').disabled=count===0;els('exportObSapBtn').disabled=count===0;
 updatePolygonStageSummary();
 return app.polySummary;
}
function csvQuote(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function downloadCsv(filename,rows){const text='\uFEFF'+rows.map(row=>row.map(csvQuote).join(',')).join('\r\n');const blob=new Blob([text],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function exportPolygonSummary(){const s=app.polySummary;if(!s||!s.count){toast('Gambar polygon yang mencakup block terlebih dahulu.');return}const head=['Record','Material_Class','Block_Count','Area_m2','Area_ha','Volume_m3','Tonnage_t','Ni_weighted_pct','Fe_weighted_pct','Weighting_Method'];const out=[head,['TOTAL_POLYGON','ALL',s.count,s.area,s.areaHa,s.volume,s.tonnes,s.avgNi,s.avgFe,'SUMPRODUCT(tonnage,grade)/SUM(tonnage)']];for(const cls of Object.keys(s.rowsByClass)){const g=s.rowsByClass[cls];out.push(['CLASS',cls,g.count,s.area,s.areaHa,g.vol,g.tonnes,g.tonnes?g.niMass/g.tonnes:0,g.tonnes?g.feMass/g.tonnes:0,'SUMPRODUCT(tonnage,grade)/SUM(tonnage)'])}downloadCsv('Mine_Reserve_polygon_summary.csv',out);toast('Ringkasan polygon diunduh.')}
function exportObSapSummary(){
 const s=app.polySummary;if(!s||!s.count){toast('Gambar polygon yang mencakup block terlebih dahulu.');return}
 const out=[
  ['Record','Category','Ni_Cutoff','Block_Count','Area_m2','Area_ha','Volume_m3','Tonnage_t','Ni_weighted_pct','Fe_weighted_pct','SR_OB_tonnes_over_Saprolit_tonnes','Weighting_Method'],
  ['CATEGORY','OB','Ni < 1.20%',s.opGroups.OB.count,s.area,s.areaHa,s.opGroups.OB.vol,s.opGroups.OB.tonnes,s.opGroups.OB.avgNi,s.opGroups.OB.avgFe,'','SUMPRODUCT(tonnage,grade)/SUM(tonnage)'],
  ['CATEGORY','Saprolit','Ni >= 1.20%',s.opGroups.Saprolit.count,s.area,s.areaHa,s.opGroups.Saprolit.vol,s.opGroups.Saprolit.tonnes,s.opGroups.Saprolit.avgNi,s.opGroups.Saprolit.avgFe,'','SUMPRODUCT(tonnage,grade)/SUM(tonnage)'],
  ['SR','OB/Saprolit','OB_Ni<1.20%;Saprolit_Ni>=1.20%','','', '', '', '', '', '', s.sr===null?'':s.sr,'Tonase OB / Tonase Saprolit']
 ];
 downloadCsv('Mine_Reserve_polygon_OB_Saprolit_SR.csv',out);toast('Ringkasan OB/Saprolit dan SR diunduh.');
}
function exportPolygonBlocks(){const s=app.polySummary;if(!s||!s.count){toast('Gambar polygon yang mencakup block terlebih dahulu.');return}const out=[['X','Y','Z','source_product_class','material_class','Ni_percent','Fe_percent','density_t_m3','block_volume_m3','block_tonnage_t']];for(const i of s.indices){const r=app.rows[i],den=(Number.isFinite(r.density)&&r.density>0)?r.density:1.65;out.push([r.x,r.y,r.z,r.sourceCls,r.cls,r.ni,r.fe,den,BLOCK_VOL,BLOCK_VOL*den])}downloadCsv('Mine_Reserve_polygon_blocks.csv',out);toast('Block dalam polygon diunduh.')}

function updatePolyStatus(){if(app.drawing){els('polygonStatus').textContent=`Mode gambar aktif · ${app.draft.length} titik. Klik titik di batas area, lalu tekan Selesai polygon.`;return}if(app.floorPoly.length>=3){const area=polygonArea(app.floorPoly);const found=app.rows.length?findAutoTopRL(app.floorPoly):null;els('polygonStatus').textContent=`Polygon: ${app.floorPoly.length} titik · ${fmt(area,0)} m² (${fmt(area/10000,3)} ha)${found?` · ${fmt(found.count)} kolom XY · RL top lokal ${fmt(found.minTop,1)}–${fmt(found.maxTop,1)} m`:' · level belum tersedia'}.`;}else{els('polygonStatus').textContent='Belum ada polygon. Gambar polygon yang melingkupi pusat block yang ingin dianalisis.'}els('finishBtn').disabled=!(app.drawing&&app.draft.length>=3);els('undoBtn').disabled=!(app.drawing&&app.draft.length>0)}
function polyPath(poly,close=true){if(!poly.length)return;const first=worldToScreen(poly[0].x,poly[0].y);ctx.beginPath();ctx.moveTo(first.x,first.y);for(let i=1;i<poly.length;i++){const p=worldToScreen(poly[i].x,poly[i].y);ctx.lineTo(p.x,p.y)}if(close)ctx.closePath()}
function drawCollarsOnCanvas(){
  if(!app.showCollars||!app.collars.length)return {visible:0,labels:0};
  const visible=[];
  for(const c of app.collars){const p=worldToScreen(c.x,c.y);if(p.x < -18 || p.x > app.viewW+18 || p.y < -18 || p.y > app.viewH+18)continue;visible.push({c,p})}
  ctx.save();
  for(const item of visible){
    const {c,p}=item,selected=app.selectedCollar&&app.selectedCollar.id===c.id;
    const r=selected?6.4:(app.scale<0.3?1.2:3.0);
    ctx.beginPath();ctx.arc(p.x,p.y,r+(app.scale<0.3?0.3:1.8),0,Math.PI*2);ctx.fillStyle='#f4fffd';ctx.fill();
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fillStyle=selected?'#ff5f8f':'#ffc85a';ctx.fill();ctx.lineWidth=selected?2.2:1.2;ctx.strokeStyle=selected?'#ffffff':'#17353b';ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,selected?1.8:1.2,0,Math.PI*2);ctx.fillStyle='#102027';ctx.fill();
  }
  let labels=0;
  if(app.showCollarLabels && app.scale>=0.3){
    const cellW=app.scale<0.45?150:(app.scale<0.9?118:(app.scale<1.8?92:70));
    const cellH=app.scale<0.45?44:(app.scale<0.9?38:(app.scale<1.8?32:27));
    const selectedId=app.selectedCollar&&app.selectedCollar.id;
    const sorted=visible.slice().sort((a,b)=>(b.c.id===selectedId?1:0)-(a.c.id===selectedId?1:0));
    const occupied=new Set();ctx.font='10px ui-monospace, SFMono-Regular, Menlo, monospace';
    for(const item of sorted){
      const {c,p}=item,selected=c.id===selectedId,cell=`${Math.floor(p.x/cellW)}|${Math.floor(p.y/cellH)}`;
      if(occupied.has(cell)&&!selected)continue;occupied.add(cell);
      const text=c.id,tw=Math.ceil(ctx.measureText(text).width),bw=tw+10,bh=17;let bx=p.x+8,by=p.y-21;
      if(bx+bw>app.viewW-3)bx=p.x-bw-8;if(by<3)by=p.y+9;bx=Math.max(3,Math.min(app.viewW-bw-3,bx));by=Math.max(3,Math.min(app.viewH-bh-3,by));
      ctx.fillStyle=selected?'#482234ed':'#0b151bea';ctx.strokeStyle=selected?'#ff5f8f':'#ffc85a';ctx.lineWidth=selected?1.3:.8;
      ctx.beginPath();ctx.rect(bx,by,bw,bh);ctx.fill();ctx.stroke();ctx.fillStyle=selected?'#ffffff':'#ffe5a0';ctx.fillText(text,bx+5,by+11.5);labels++;
    }
  }
  ctx.restore();return {visible:visible.length,labels};
}
function isObMaterial(r){return /(^|[^A-Z])OB([^A-Z]|$)|WASTE/i.test(String(r.sourceCls||''))||r.cls==='OB/Waste'}
function isSapMaterial(r){return ['SAP <1.25','LGSO','MGSO','HGSO','VHGSO'].includes(r.cls)||/SAPROLITE|\b(HGS|MGS|LGS)\b/i.test(String(r.sourceCls||''))}
function materialVisible(r,filter=app.materialFilter){return filter==='all'||(filter==='ob'&&isObMaterial(r))||(filter==='sap'&&isSapMaterial(r))}
function syncMaterialFilterButtons(){[['mapMaterialAll','all'],['mapMaterialOB','ob'],['mapMaterialSap','sap'],['mrMaterialAll','all'],['mrMaterialOB','ob'],['mrMaterialSap','sap']].forEach(([id,v])=>{const b=els(id);if(b){b.classList.toggle('active',app.materialFilter===v);b.setAttribute('aria-pressed',String(app.materialFilter===v))}})}
function setMaterialFilter(filter){app.materialFilter=filter;syncMaterialFilterButtons();draw();if(els('mrSectionModal')?.style.display==='flex')renderSection()}
function draw(){if(!ctx||!app.viewW||!app.viewH)return;positionRasterLayer();mrApplyMapRotation();ctx.setTransform(app.dpr,0,0,app.dpr,0,0);ctx.clearRect(0,0,app.viewW,app.viewH);const sc=app.scale;ctx.save();const grid=100*Math.pow(10,Math.floor(Math.log10(1/sc)));const visibleLeft=app.centerX-app.viewW/(2*sc),visibleRight=app.centerX+app.viewW/(2*sc),visibleBottom=app.centerY-app.viewH/(2*sc),visibleTop=app.centerY+app.viewH/(2*sc);const g=Math.max(25,grid);ctx.strokeStyle='#d9e3e522';ctx.lineWidth=1;ctx.beginPath();for(let x=Math.floor(visibleLeft/g)*g;x<=visibleRight;x+=g){const s=worldToScreen(x,app.centerY);ctx.moveTo(s.x,0);ctx.lineTo(s.x,app.viewH)}for(let y=Math.floor(visibleBottom/g)*g;y<=visibleTop;y+=g){const s=worldToScreen(app.centerX,y);ctx.moveTo(0,s.y);ctx.lineTo(app.viewW,s.y)}ctx.stroke();ctx.restore();
// Ortho is rendered by the positioned HTML image layer below this transparent canvas.
let visibleBlockSamples=0;if(app.showBlocks&&app.rows.length){ctx.save();let renderBudget=app.viewW<700?42000:105000;let step=Math.max(1,Math.ceil(app.rows.length/renderBudget));const size=Math.max(1.3,DX*sc*.88);for(let i=0;i<app.rows.length;i+=step){const r=app.rows[i];if(!materialVisible(r))continue;const p=worldToScreen(r.x,r.y);if(p.x < -size||p.x > app.viewW+size||p.y < -size||p.y > app.viewH+size)continue;visibleBlockSamples++;const selected=!app.designApplied||app.selected[i]===1;ctx.globalAlpha=app.designApplied?(selected?.92:.12):.82;ctx.fillStyle=colors[r.cls]||'#c5b3f5';if(size>=3.1){ctx.fillRect(p.x-size/2,p.y-size/2,size,size)}else{ctx.fillRect(p.x,p.y,Math.max(1.2,size),Math.max(1.2,size))}if(app.designApplied&&selected&&size>4){ctx.strokeStyle='#f4fff7aa';ctx.lineWidth=.5;ctx.strokeRect(p.x-size/2,p.y-size/2,size,size)}}ctx.restore()}
if(app.crestPoly.length>=3){polyPath(app.crestPoly);ctx.save();ctx.fillStyle='#c7f36a12';ctx.fill();ctx.setLineDash([7,5]);ctx.strokeStyle='#c7f36a';ctx.lineWidth=2;ctx.stroke();ctx.restore()}
if(app.floorPoly.length>=3){polyPath(app.floorPoly);ctx.save();ctx.fillStyle='#51d6c51f';ctx.fill();ctx.strokeStyle='#51d6c5';ctx.lineWidth=2;ctx.stroke();for(const v of app.floorPoly){const p=worldToScreen(v.x,v.y);ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,Math.PI*2);ctx.fillStyle='#e7fffb';ctx.fill();ctx.strokeStyle='#0b302c';ctx.stroke()}ctx.restore()}
if(app.draft.length){polyPath(app.draft,false);ctx.save();ctx.strokeStyle='#fff4b5';ctx.lineWidth=2;ctx.setLineDash([4,4]);ctx.stroke();ctx.setLineDash([]);for(const v of app.draft){const p=worldToScreen(v.x,v.y);ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#fff4b5';ctx.fill()}ctx.restore()}
const collarView=drawCollarsOnCanvas();drawGpsOnCanvas();
// World coordinate crosshair and status labels
ctx.save();ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#e7f1f1bd';const sb=100/sc;let scaleMeters=Math.pow(10,Math.floor(Math.log10(sb)));if(sb/scaleMeters>5)scaleMeters*=5;else if(sb/scaleMeters>2)scaleMeters*=2;const scalePx=scaleMeters*sc;els('scaleWidget').childNodes[0].textContent=`${fmt(scaleMeters)} m`;els('scaleBar').style.width=`${Math.max(18,Math.min(130,scalePx))}px`;ctx.restore();els('mapSub').textContent=app.rows.length?`${fmt(app.rows.length)} block · ${app.rasterReady?'ortho aktif':'ortho tidak tersedia'} · ${app.showBlocks?`tampil ${fmt(visibleBlockSamples)} sampel`:'block disembunyikan'} · ${app.showCollars?`collar ${fmt(collarView.visible)} titik`:'collar disembunyikan'} · skala ${fmt(1/sc,0)} m/pixel`:'Memuat data…';els('visibleFooter').textContent=`${fmt(app.rows.length)} block · ${fmt(app.collars.length)} collar · preview ortho ~1 m/pixel`;els('mapHint').textContent=app.drawing?'MODE GAMBAR · Klik titik pada peta, lalu tekan Selesai':!app.showBlocks?'BLOCK MODEL DISEMBUNYIKAN · Ortofoto, polygon, dan summary tetap aktif · klik “Tampilkan blok” untuk memunculkan kembali':app.designApplied?`${app.stats.mode==='layer'?'Lapisan':'Akumulasi'} ${fmt(app.stats.depth)} m per kolom · RL target ${fmt(app.stats.floor,1)}–${fmt(app.stats.floorMax,1)} · slope ${SLOPE_DEG}°`:'Klik collar untuk detail ID · tekan Cari posisi untuk GPS · drag untuk pan · scroll untuk zoom · gambar polygon untuk memilih area';}
function updateExtentWarning(){if(!app.rows.length)return;const b=app.allBounds;const out=app.rows.reduce((n,r)=>n+(r.x<rasterBounds.minX||r.x>rasterBounds.maxX||r.y<rasterBounds.minY||r.y>rasterBounds.maxY?1:0),0);const warning=els('extentWarning');if(out){warning.innerHTML=`<b>Periksa cakupan ortofoto:</b> ${fmt(out)} block (${fmt(out/app.rows.length*100,1)}%) berada di luar batas citra TIFF. Sisi barat ortho dimulai pada X ${fmt(rasterBounds.minX,0)} m, sedangkan CSV mencapai X ${fmt(b.minX,0)} m. Block di luar citra tetap ditampilkan di latar gelap; boundary koordinat tetap pada CRS yang sama.`}else{warning.className='notice';warning.innerHTML='<b>Cakupan sesuai:</b> seluruh pusat block CSV berada di dalam footprint ortofoto.'}}
function loadRows(rows,name,headers=[]){app.csvLoadedOnce=true;app.rows=rows;app.csvName=name;app.csvHeaders=headers;app.allBounds=getDataBounds(rows);app.columnTopByKey=buildColumnTopIndex(rows);app.designApplied=false;app.selected=new Uint8Array(0);app.stats=null;app.crestPoly=[];els('csvName').textContent=name;els('csvStatus').textContent=`${fmt(rows.length)} block · X/Y/Z terbaca`;els('csvCheck').textContent='LOADED';els('csvCheck').style.color='var(--accent)';els('summaryTag').textContent='ALL BLOCKS';els('statBlocks').textContent=fmt(rows.length);let vol=rows.length*BLOCK_VOL,tonnes=0,niSum=0,feSum=0;for(const r of rows){const t=BLOCK_VOL*r.density;tonnes+=t;niSum+=t*r.ni;feSum+=t*r.fe}els('statVolume').innerHTML=`${fmt(vol)} <span class="unit">m³</span>`;els('statTonnes').innerHTML=`${fmt(tonnes)} <span class="unit">t</span>`;els('statNi').innerHTML=`${fmt(tonnes?niSum/tonnes:0,2)} <span class="unit">%</span>`;els('summaryNote').textContent='Gambar polygon untuk menghitung ringkasan tahap di dalam polygon; ringkasan total semua elevasi tersedia di bawah.';renderBreakdown(null,false);updateExtentWarning();updatePolygonSummary();els('loadProgress').style.width='100%';els('mapSub').textContent=`${fmt(rows.length)} block · CRS ${CRS}`;// Always refit after a CSV is loaded/replaced. Saved camera coordinates can
// belong to an older CRS/extent and make the raster + blocks land off-screen.
canvasSize();if(app.rasterReady){app.viewRestored=false;app.viewTouched=false;fitData();app.initialFitDone=true}else{draw()}if(app.floorPoly.length>=3){app.restoredDesign=false;calculateDesign()}else{draw()}}
const DRIVE_SYNC_STORAGE='mine-reserve-drive-sync-v2';
function setDriveStatus(message,isError=false){const el=els('driveSyncStatus');if(el){el.textContent=message;el.style.color=isError?'var(--red)':'var(--muted)'}}
function configureDriveKey(){alert('Mode lokal: CSV dan perhitungan tetap di browser Anda.\nBlock wajib: X,Y,Z,ni,fe,densitas (atau density).\nUkuran block: 12.5 × 12.5 × 1 m; CRS EPSG:32751.\nKoneksi Drive dapat ditambahkan lewat backend terautentikasi.');}
function simplePolygon(p){const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){if(j===i+1||(i===0&&j===p.length-1))continue;const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(a.x,b.x)>=Math.min(c.x,d.x)&&Math.max(c.x,d.x)>=Math.min(a.x,b.x)&&Math.max(a.y,b.y)>=Math.min(c.y,d.y)&&Math.max(c.y,d.y)>=Math.min(a.y,b.y))return false;}return true;}
function openDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open('mine-reserve-workbench',1);q.onupgradeneeded=()=>q.result.createObjectStore('snapshots');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function storeSnapshot(value){const db=await openDB();try{await new Promise((resolve,reject)=>{const t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').put(value,'active');t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}finally{db.close();}}
async function readSnapshot(){const db=await openDB();try{return await new Promise((resolve,reject)=>{const q=db.transaction('snapshots').objectStore('snapshots').get('active');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}finally{db.close();}}
async function loadBundled(){const r=await fetch('./data/remain_reserve_okt_hir0.csv');if(!r.ok)throw new Error('Dataset bawaan tidak tersedia. Impor CSV manual.');const parsed=parseCSV(await r.text());loadRows(parsed.rows,'remain_reserve_okt_hir0.csv',parsed.headers);await storeSnapshot({rows:parsed.rows,headers:parsed.headers,name:'remain_reserve_okt_hir0.csv',savedAt:new Date().toISOString()});setDriveStatus('Snapshot proyek 25 Okt 2026 · tersimpan di perangkat ini.');}
async function driveSyncLatest(){try{await loadBundled();toast('Dataset asli dipulihkan; CSV manual sebelumnya diganti.');}catch(e){setDriveStatus(e.message,true);}}
async function loadCsvUrl(){try{const saved=await readSnapshot();if(saved?.rows?.length){loadRows(saved.rows,saved.name,saved.headers);setDriveStatus('Snapshot lokal · '+saved.name+' · '+new Date(saved.savedAt).toLocaleString('id-ID'));}else await loadBundled();}catch(e){try{await loadBundled();}catch(err){els('csvCheck').textContent='IMPOR CSV';setDriveStatus(err.message,true);}}await loadLocalDrilling();}
async function loadLocalDrilling(){try{const names=['collar_ukk_d_03122024_new.csv','Collar_ALL_UKK.csv','collar-hir_04082024.csv','collar-tambahan hir.csv'];const combined=[],seen=new Set();for(const n of names){const res=await fetch('./data/'+encodeURIComponent(n));if(!res.ok)throw new Error('Collar '+n+' tidak tersedia');for(const c of parseCollarCSV(await res.text(),n)){const key=[normalizeHoleId(c.id),Number(c.x).toFixed(3),Number(c.y).toFixed(3),Number(c.z).toFixed(3),c.depth==null?'':Number(c.depth).toFixed(3)].join('|');if(!seen.has(key)){seen.add(key);combined.push(c);}}}loadCollars(combined,'Snapshot original · 25 Okt 2026');const rows=[];for(const n of ['assay_ukk_d_03122024_NEW__.csv','Assay_ALL_UKK.csv','assay-hir_04082024.csv']){const res=await fetch('./data/'+encodeURIComponent(n));if(!res.ok)throw new Error('Assay '+n+' tidak tersedia');rows.push(...parseAssayCSV(await res.text(),n));}app.assayRows=rows;app.assaysByHole=indexAssays(rows);app.assayLoaded=true;els('assayLoadStatus').textContent='LOADED · '+fmt(rows.length)+' interval · snapshot lokal';draw();}catch(e){els('assayLoadStatus').textContent=e.message;}}
function finishDraw(){if(app.draft.length>=3&&(!simplePolygon(app.draft)||polygonArea(app.draft)<0.01)){toast('Polygon bersilangan atau luas nol. Undo titik dan perbaiki.');return;}if(app.draft.length<3){toast('Polygon memerlukan minimal 3 titik.');return}app.floorPoly=app.draft.map(p=>({...p}));app.draft=[];app.drawing=false;app.crestPoly=[];app.designApplied=false;saveProjectState();canvas.classList.remove('draw-mode');els('drawBtn').classList.remove('active');els('finishBtn').disabled=true;els('undoBtn').disabled=true;updatePolyStatus();updatePolygonSummary();draw();if(app.rows.length)calculateDesign();else toast('Polygon tersimpan. Muat CSV block model untuk menghitung level otomatis.')}function startDraw(){app.drawing=true;app.draft=[];canvas.classList.add('draw-mode');els('drawBtn').classList.add('active');els('mapHint').textContent='MODE GAMBAR · Klik titik polygon, kemudian tekan Selesai polygon';updatePolyStatus();draw()}
function endDrawMode(){app.drawing=false;app.draft=[];canvas.classList.remove('draw-mode');els('drawBtn').classList.remove('active');updatePolyStatus();draw()}
function createBox(){if(!app.allBounds){toast('CSV belum dimuat.');return}const b=app.allBounds;const pad=DX/2;app.floorPoly=[{x:b.minX-pad,y:b.minY-pad},{x:b.maxX+pad,y:b.minY-pad},{x:b.maxX+pad,y:b.maxY+pad},{x:b.minX-pad,y:b.maxY+pad}];updatePolygonSummary();app.crestPoly=[];app.designApplied=false;saveProjectState();app.drawing=false;app.draft=[];canvas.classList.remove('draw-mode');updatePolyStatus();draw();toast('Polygon kotak dibuat dari extent seluruh CSV.');if(app.rows.length)calculateDesign()}function clearDesign(){app.floorPoly=[];app.crestPoly=[];app.draft=[];app.drawing=false;app.designApplied=false;app.topRL=null;saveProjectState();app.selected=new Uint8Array(0);app.stats=null;canvas.classList.remove('draw-mode');els('drawBtn').classList.remove('active');els('summaryTag').textContent='ALL BLOCKS';els('exportStageBtn').disabled=true;if(app.rows.length)loadRows(app.rows,app.csvName,app.csvHeaders);else draw();updatePolyStatus();updateAutoLevelPreview();toast('Polygon dihapus.')}
function pointerPosition(e){const r=els('mapbox').getBoundingClientRect();const x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,a=-mrMapRotation*Math.PI/180;return {x:r.width/2+x*Math.cos(a)-y*Math.sin(a),y:r.height/2+x*Math.sin(a)+y*Math.cos(a)}}
// Mouse + touchscreen controls. Two fingers pinch-zoom; one finger pans or draws.
const mrActivePointers = new Map();
let mrPinchDistance = 0;
let mrWasPinching = false;
function mrDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function mrMidpoint(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}}
canvas.addEventListener('pointerdown',e=>{
  app.viewTouched=true;
  const p=pointerPosition(e);
  mrActivePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(e.pointerType==='touch')canvas.style.touchAction='none';
  if(e.pointerType==='touch'&&mrActivePointers.size>=2&&!app.drawing){
    const pts=[...mrActivePointers.values()];
    mrPinchDistance=mrDistance(pts[0],pts[1]);
    mrWasPinching=true;
    app.drag=null;
    try{canvas.setPointerCapture(e.pointerId)}catch(_){}
    e.preventDefault();
    return;
  }
  if(mrWasPinching&&e.pointerType==='touch')return;
  if(app.drawing){
    app.drag={draw:true,start:p,last:p,moved:false,pointerId:e.pointerId};
    try{canvas.setPointerCapture(e.pointerId)}catch(_){}
    return;
  }
  app.drag={start:p,last:p,moved:false,cx:app.centerX,cy:app.centerY,pointerId:e.pointerId};
  try{canvas.setPointerCapture(e.pointerId)}catch(_){}
  canvas.style.cursor='grabbing';
});
canvas.addEventListener('pointermove',e=>{
  if(mrActivePointers.has(e.pointerId))mrActivePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(e.pointerType==='touch'&&mrActivePointers.size>=2&&!app.drawing){
    const pts=[...mrActivePointers.values()];
    const dist=mrDistance(pts[0],pts[1]);
    const mid=mrMidpoint(pts[0],pts[1]);
    const rect=canvas.getBoundingClientRect();
    if(mrPinchDistance>0&&dist>0)zoomAt(dist/mrPinchDistance,mid.x-rect.left,mid.y-rect.top);
    mrPinchDistance=dist;
    mrWasPinching=true;
    app.drag=null;
    e.preventDefault();
    return;
  }
  if(!app.drag||app.drag.draw||app.drag.pointerId!==e.pointerId)return;
  const p=pointerPosition(e),dx=p.x-app.drag.start.x,dy=p.y-app.drag.start.y;
  if(Math.abs(dx)+Math.abs(dy)>2)app.drag.moved=true;
  app.centerX=app.drag.cx-dx/app.scale;
  app.centerY=app.drag.cy+dy/app.scale;
  draw();
});
function mrFinishPointer(e,cancelled=false){
  const wasPinching=mrWasPinching;
  mrActivePointers.delete(e.pointerId);
  if(mrActivePointers.size<2)mrPinchDistance=0;
  if(wasPinching){
    if(mrActivePointers.size===0)mrWasPinching=false;
    app.drag=null;
    canvas.style.cursor=app.drawing?'crosshair':'grab';
    saveProjectState();
    return;
  }
  if(!app.drag||app.drag.pointerId!==e.pointerId){if(mrActivePointers.size===0)mrWasPinching=false;return}
  if(!cancelled){
    const wasDraw=app.drag.draw,moved=app.drag.moved,p=pointerPosition(e);
    if(wasDraw){
      const world=screenToWorld(p.x,p.y);
      app.draft.push(world);
      els('finishBtn').disabled=app.draft.length<3;
      els('undoBtn').disabled=app.draft.length===0;
      updatePolyStatus();draw();
    }else{
      canvas.style.cursor=app.drawing?'crosshair':'grab';
      if(!moved&&!app.drawing){
        const hit=findNearestCollarAtScreen(p.x,p.y,14);
        if(hit)selectCollar(hit,false);
      }
    }
  }
  app.drag=null;
  if(mrActivePointers.size===0)mrWasPinching=false;
  saveProjectState();
}
canvas.addEventListener('pointerup',e=>mrFinishPointer(e,false));
canvas.addEventListener('pointercancel',e=>mrFinishPointer(e,true));
canvas.addEventListener('wheel',e=>{e.preventDefault();app.viewTouched=true;const p=pointerPosition(e);zoomAt(e.deltaY<0?1.18:.84,p.x,p.y)},{passive:false});
canvas.addEventListener('dblclick',e=>{if(app.drawing){e.preventDefault();finishDraw()}});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&app.drawing){endDrawMode();toast('Mode gambar dibatalkan.')}});
els('rotateLeftBtn').addEventListener('click',()=>mrRotateMap(-15));els('rotateRightBtn').addEventListener('click',()=>mrRotateMap(15));els('northUpBtn').addEventListener('click',mrNorthUp);mrEnableOrientationControls();
els('gpsLocateBtn').addEventListener('click',startGpsLocate);els('gpsFollowBtn').addEventListener('click',toggleGpsFollow);els('drawBtn').addEventListener('click',()=>{if(app.drawing)endDrawMode();else startDraw()});els('finishBtn').addEventListener('click',finishDraw);els('undoBtn').addEventListener('click',()=>{app.draft.pop();updatePolyStatus();draw()});els('clearBtn').addEventListener('click',clearDesign);els('boxBtn').addEventListener('click',createBox);els('applyDesignBtn').addEventListener('click',calculateDesign);els('exportStageBtn').addEventListener('click',exportSelectedCsv);els('exportPolygonStageSummaryBtn').addEventListener('click',exportPolygonStageSummary);els('exportPolygonStageBlocksBtn').addEventListener('click',exportPolygonStageBlocks);els('exportPolySummaryBtn').addEventListener('click',exportPolygonSummary);els('exportPolyBlocksBtn').addEventListener('click',exportPolygonBlocks);els('exportObSapBtn').addEventListener('click',exportObSapSummary);els('depthMinusBtn').addEventListener('click',()=>{els('cutDepth').value=String(Math.max(1,Math.round(Number(els('cutDepth').value)||1)-1));updateAutoLevelPreview();if(app.floorPoly.length>=3)calculateDesign()});els('depthPlusBtn').addEventListener('click',()=>{els('cutDepth').value=String(Math.max(1,Math.round(Number(els('cutDepth').value)||1)+1));updateAutoLevelPreview();if(app.floorPoly.length>=3)calculateDesign()});els('cutDepth').addEventListener('change',()=>{updateAutoLevelPreview();saveProjectState();if(app.floorPoly.length>=3)calculateDesign()});els('selectionMode').addEventListener('change',()=>{app.selectionMode=els('selectionMode').value;saveProjectState();if(app.floorPoly.length>=3)calculateDesign()});els('fitBtn').addEventListener('click',fitData);els('fitBtn2').addEventListener('click',fitData);els('zoomInBtn').addEventListener('click',()=>zoomAt(1.25));els('zoomOutBtn').addEventListener('click',()=>zoomAt(.8));els('orthoToggle').addEventListener('click',()=>{app.showOrtho=!app.showOrtho;els('orthoToggle').classList.toggle('active',app.showOrtho);els('orthoToggle').textContent=`Ortofoto ${app.showOrtho?'✓':'×'}`;els('orthoToggle').setAttribute('aria-pressed',String(app.showOrtho));draw()});els('blocksToggle').addEventListener('click',()=>setBlocksVisible(!app.showBlocks));['mapMaterialAll','mapMaterialOB','mapMaterialSap'].forEach((id,i)=>els(id).addEventListener('click',()=>setMaterialFilter(['all','ob','sap'][i])));els('loadCsvBtn').addEventListener('click',()=>els('csvFile').click());
els('collarsToggle').addEventListener('click',()=>{app.showCollars=!app.showCollars;syncCollarToggleUI();saveProjectState();draw();toast(app.showCollars?'Titik collar ditampilkan kembali.':'Seluruh titik collar disembunyikan.')});
els('collarLabelsToggle').addEventListener('click',()=>{app.showCollarLabels=!app.showCollarLabels;syncCollarToggleUI();saveProjectState();draw();toast(app.showCollarLabels?'Label ID collar ditampilkan (anti-tumpang-tindih).':'Label ID collar disembunyikan; titik tetap tampil.')});
els('collarFindBtn').addEventListener('click',searchCollar);
els('collarSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchCollar()}});
els('collarFitBtn').addEventListener('click',fitCollarData);
els('collarLoadBtn').addEventListener('click',()=>els('collarFile').click());
els('collarSelectedInfo').addEventListener('click',e=>{const b=e.target.closest('#viewAssayBtn');if(!b||b.disabled)return;showAssayLogForSelected()});
els('closeAssayLogBtn').addEventListener('click',()=>{closeAssayLog();toast('Model bor ditutup; pilihan titik tetap tersimpan.')});
els('assayIntervalBody').addEventListener('click',e=>{const row=e.target.closest('tr[data-assay-row]');if(!row)return;const index=Number(row.dataset.assayRow);const seg=els('assayProfile').querySelector(`[data-assay-row="${index}"]`);if(seg){seg.classList.add('active');seg.scrollIntoView({block:'nearest',behavior:'smooth'});setTimeout(()=>seg.classList.remove('active'),1200)}});
els('collarFile').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{const rows=await readCollarCsvFile(f);loadCollars(rows,f.name,true);toast(`Data collar dimuat: ${fmt(rows.length)} titik. Data tersimpan di perangkat ini.`)}catch(err){toast(err.message||'Gagal membaca CSV collar.')}finally{e.target.value=''}});
els('csvFile').addEventListener('change',async e=>{const f=e.target.files&&e.target.files[0];if(!f)return;try{els('loadProgress').style.width='20%';const parsed=await readCsvFile(f);loadRows(parsed.rows,f.name,parsed.headers);await storeSnapshot({rows:parsed.rows,headers:parsed.headers,name:f.name,savedAt:new Date().toISOString()});setDriveStatus('CSV manual tervalidasi · tersimpan offline · '+f.name);toast(`CSV dimuat: ${fmt(parsed.rows.length)} block.`)}catch(err){setDriveStatus(err.message||'Gagal membaca CSV.',true);toast(err.message||'Gagal membaca CSV.')}finally{e.target.value=''}});

const PROJECT_STORAGE_KEY='minereserve-workbench-design-v2';
function saveProjectState(){try{const data={floorPoly:app.floorPoly,cutDepth:els('cutDepth').value,selectionMode:els('selectionMode').value,designApplied:app.designApplied,showBlocks:app.showBlocks,showCollars:app.showCollars,showCollarLabels:app.showCollarLabels};localStorage.setItem(PROJECT_STORAGE_KEY,JSON.stringify(data))}catch(e){/* storage is optional; core calculations remain available */}}
function syncBlocksToggleUI(){const b=els('blocksToggle');if(!b)return;b.classList.toggle('active',!!app.showBlocks);b.textContent=app.showBlocks?'Sembunyikan blok':'Tampilkan blok';b.setAttribute('aria-pressed',String(!!app.showBlocks));b.setAttribute('aria-label',app.showBlocks?'Sembunyikan seluruh block model':'Tampilkan kembali seluruh block model');b.title=app.showBlocks?'Sembunyikan seluruh block model; ortofoto, polygon, dan ringkasan tetap aktif':'Tampilkan kembali seluruh block model di atas ortofoto';}
function setBlocksVisible(visible){app.showBlocks=!!visible;syncBlocksToggleUI();saveProjectState();draw();toast(app.showBlocks?'Block model ditampilkan kembali.':'Seluruh block model disembunyikan; ortofoto, polygon, dan ringkasan tetap aktif.');}
function restoreProjectState(){try{const raw=localStorage.getItem(PROJECT_STORAGE_KEY);if(!raw)return;const s=JSON.parse(raw);if(Array.isArray(s.floorPoly)&&s.floorPoly.length>=3&&s.floorPoly.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))app.floorPoly=s.floorPoly.map(p=>({x:p.x,y:p.y}));if(s.cutDepth!==undefined)els('cutDepth').value=String(Math.max(1,Math.round(Number(s.cutDepth)||1)));if(s.selectionMode==='cumulative'||s.selectionMode==='layer')els('selectionMode').value=s.selectionMode;if(typeof s.showBlocks==='boolean')app.showBlocks=s.showBlocks;if(typeof s.showCollars==='boolean')app.showCollars=s.showCollars;if(typeof s.showCollarLabels==='boolean')app.showCollarLabels=s.showCollarLabels;syncBlocksToggleUI();syncCollarToggleUI();app.cutDepth=Math.max(1,Math.round(Number(els('cutDepth').value)||1));app.selectionMode=els('selectionMode').value;app.viewRestored=false;app.restoredDesign=!!s.designApplied&&app.floorPoly.length>=3;if(app.floorPoly.length>=3){updatePolyStatus();updateAutoLevelPreview()}}catch(e){/* ignore invalid/corrupt saved design */}}
let deferredInstallPrompt=null;let pwaRegistration=null;let pwaReady=false;let reloadAfterUpdate=false;
const appStatusText=els('appStatusText'),appStatusDot=els('appStatusDot'),installAppBtn=els('installAppBtn'),updateAppBtn=els('updateAppBtn');
function setPwaStatus(text,ready=false){if(appStatusText)appStatusText.textContent=text;if(appStatusDot)appStatusDot.style.background=ready?'#c7f36a':(navigator.onLine?'#ffbd59':'#ff8a65')}
function updateNetworkStatus(){if(!pwaRegistration){setPwaStatus(navigator.onLine?'Online · offline belum disiapkan':'Offline · mode lokal',false);return}setPwaStatus(navigator.onLine?(pwaReady?'Online · offline siap':'Online · menyimpan offline…'):(pwaReady?'Offline · cache siap':'Offline · cache belum lengkap'),pwaReady)}
function isAppStandalone(){return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true}
function showInstallButton(){if(!isAppStandalone()&&(deferredInstallPrompt||/iphone|ipad|ipod|android/i.test(navigator.userAgent)||window.matchMedia('(max-width: 780px)').matches)){installAppBtn.classList.remove('hidden');if(!deferredInstallPrompt)installAppBtn.textContent='Cara pasang di HP'}}
async function setupOfflineApp(){
 updateAppBtn.textContent='Periksa versi';updateAppBtn.onclick=async()=>{if(pwaRegistration){await pwaRegistration.update();toast('Pemeriksaan versi selesai. Muat ulang untuk memakai pembaruan.');}};
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;installAppBtn.classList.remove('hidden');});
 installAppBtn.onclick=async()=>{if(deferredInstallPrompt){await deferredInstallPrompt.prompt();deferredInstallPrompt=null;}else toast('Gunakan menu browser → Tambahkan ke layar utama.');};
 if(!('serviceWorker' in navigator)){setPwaStatus('Offline app requires HTTPS',false);return;}
 try{pwaRegistration=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;pwaReady=true;updateNetworkStatus();window.addEventListener('online',updateNetworkStatus);window.addEventListener('offline',updateNetworkStatus);}catch(e){setPwaStatus('Cache offline belum siap',false);}
}

function ensureGeoTIFFLibrary() {
  if (window.GeoTIFF?.fromArrayBuffer) {
    return Promise.resolve(window.GeoTIFF);
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/geotiff';
    script.async = true;

    script.onload = () => {
      if (window.GeoTIFF?.fromArrayBuffer) {
        resolve(window.GeoTIFF);
      } else {
        reject(new Error('Library GeoTIFF tidak tersedia.'));
      }
    };

    script.onerror = () =>
      reject(new Error('Library GeoTIFF gagal diunduh.'));

    document.head.appendChild(script);
  });
}

function setOrthoDetails(fileName, status) {
  const statusEl = els('rasterStatus');
  const fileLine = statusEl?.closest('.file-line');
  const nameEl = fileLine?.querySelector('.file-info b');

  if (nameEl) nameEl.textContent = fileName + ' · Ortofoto';
  if (statusEl) statusEl.textContent = status;
}

function setOrthoConvertStatus(message,isError=false){
 const el=els('orthoConvertStatus');if(el){el.textContent=message;el.style.color=isError?'var(--red)':'var(--muted)'}
}
function downloadBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function convertImportedGeoTIFF(file){
 if(!file) return;
 const button=els('importOrthoTiffBtn');if(button){button.disabled=true;button.textContent='Mengonversi TIFF…'}
 let objectUrl=null;
 try{
  if(!/\.tiff?$/i.test(file.name))throw new Error('Pilih file berformat .tif atau .tiff.');
  setOrthoConvertStatus('Membaca GeoTIFF… file '+(file.size/1024/1024).toFixed(1)+' MB.');
  const GeoTIFF=await ensureGeoTIFFLibrary();
  const arrayBuffer=await file.arrayBuffer();
  const tiff=await GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image=await tiff.getImage();
  const width=Number(image.getWidth()),height=Number(image.getHeight());
  if(!width||!height)throw new Error('Dimensi TIFF tidak valid.');
  const bbox=image.getBoundingBox();
  if(!Array.isArray(bbox)||bbox.length<4||!bbox.every(Number.isFinite)||bbox[2]<=bbox[0]||bbox[3]<=bbox[1])throw new Error('GeoTIFF tidak memiliki bounding box koordinat yang valid.');
  const keys=image.getGeoKeys?image.getGeoKeys():{};
  const epsg=keys?.ProjectedCSTypeGeoKey||keys?.GeographicTypeGeoKey||null;
  const crs=epsg?'EPSG:'+epsg:'CRS tidak terdeteksi';
  const maxWidth=6000,scale=Math.min(1,maxWidth/width);
  const outW=Math.max(1,Math.round(width*scale)),outH=Math.max(1,Math.round(height*scale));
  setOrthoConvertStatus('Membuat preview '+outW.toLocaleString('id-ID')+' × '+outH.toLocaleString('id-ID')+' px…');
  const rasters=await image.readRasters({width:outW,height:outH,interleave:true});
  const samples=Number(image.getSamplesPerPixel?image.getSamplesPerPixel():1);
  const canvas=document.createElement('canvas');canvas.width=outW;canvas.height=outH;
  const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)throw new Error('Canvas tidak tersedia pada browser ini.');
  const img=ctx.createImageData(outW,outH);
  const len=outW*outH;
  const sampleMax=rasters instanceof Uint8Array||rasters instanceof Uint8ClampedArray?255:rasters instanceof Uint16Array?65535:rasters instanceof Int16Array?32767:rasters instanceof Float32Array||rasters instanceof Float64Array?1:255;
  const channel=(v)=>Math.max(0,Math.min(255,Math.round((Number(v)||0)*(sampleMax===1?255:255/sampleMax))));
  for(let p=0;p<len;p++){
   const src=p*samples,dst=p*4;
   if(samples>=3){img.data[dst]=channel(rasters[src]);img.data[dst+1]=channel(rasters[src+1]);img.data[dst+2]=channel(rasters[src+2]);}
   else{const g=channel(rasters[src]);img.data[dst]=g;img.data[dst+1]=g;img.data[dst+2]=g;}
   img.data[dst+3]=samples>=4?channel(rasters[src+3]):255;
  }
  ctx.putImageData(img,0,0);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Konversi WebP gagal. Browser mungkin tidak mendukung WebP.')),'image/webp',0.88));
  if(!blob||blob.size<100)throw new Error('Hasil WebP kosong atau terlalu kecil.');
  const bounds={minX:Number(bbox[0]),minY:Number(bbox[1]),maxX:Number(bbox[2]),maxY:Number(bbox[3])};
  const manifest={name:file.name.replace(/\.tiff?$/i,'_preview.webp'),source:file.name,sourceBytes:file.size,sourceWidth:width,sourceHeight:height,previewWidth:outW,previewHeight:outH,crs,resolutionMetersPerPixel:[(bounds.maxX-bounds.minX)/width,(bounds.maxY-bounds.minY)/height],bounds,format:'WebP',quality:88,convertedAt:new Date().toISOString()};
  objectUrl=URL.createObjectURL(blob);
  rasterBounds=bounds;
  await setRasterSourceAndWait(objectUrl);
  setOrthoDetails(file.name,'Preview WebP '+outW.toLocaleString('id-ID')+'×'+outH.toLocaleString('id-ID')+' · '+crs);
  app.rasterReady=true;app.viewRestored=false;app.viewTouched=false;fitData();app.initialFitDone=true;
  const base=file.name.replace(/\.tiff?$/i,'').replace(/[^a-z0-9_-]+/gi,'_');
  downloadBlob(blob,base+'_preview.webp');
  downloadBlob(new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}),base+'_preview.json');
  setOrthoConvertStatus('Berhasil dikonversi dan ditampilkan. WebP + JSON diunduh; unggah kedua file ke folder Drive/repo agar tersedia di perangkat lain.');
  toast('TIFF berhasil dikonversi ke WebP + JSON.');
 }catch(err){console.error('Konversi GeoTIFF gagal:',err);setOrthoConvertStatus('Gagal: '+(err.message||'tidak dapat memproses GeoTIFF.'),true);toast('Konversi TIFF gagal. Periksa status import ortofoto.')}
 finally{if(objectUrl&&app.raster.src!==objectUrl)URL.revokeObjectURL(objectUrl);if(button){button.disabled=false;button.textContent='Import TIFF → WebP + JSON'}}
}
function setRasterSourceAndWait(src) {
  return new Promise((resolve, reject) => {
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      app.raster.removeEventListener('load', onLoad);
      app.raster.removeEventListener('error', onError);
    };

    const onLoad = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Browser gagal menampilkan citra ortofoto.'));
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Waktu tunggu pemuatan ortofoto habis.'));
    }, 60000);

    app.raster.addEventListener('load', onLoad);
    app.raster.addEventListener('error', onError);
    app.raster.src = src;
  });
}

async function loadNewestDriveOrtho() {
  const previewUrl = './ortho_all_new_preview.webp';
  const manifestUrl = './ortho_all_new_preview.json';
  const rawPreviewUrl = './ortho_all_new_preview.webp';
  const knownBounds = {
    minX: 303559.56090125284,
    minY: 9787504.855706707,
    maxX: 313023.06090125284,
    maxY: 9794742.855706707
  };

  async function loadPreview(src, bounds, label) {
    rasterBounds = { ...bounds };
    await setRasterSourceAndWait(src);
    setOrthoDetails(
      'ortho_all_new(1).tif',
      label + ' · EPSG:32751 · sumber 18.927×14.476 px'
    );
    toast('Ortofoto baru berhasil dimuat.');
  }

  try {
    setOrthoDetails('Ortofoto baru', 'Memeriksa pratinjau ortofoto…');
    let manifest = null;
    try {
      const response = await fetch(manifestUrl + '?v=ortho-20261021', { cache: 'no-store' });
      if (response.ok) manifest = await response.json();
    } catch (e) {
      console.warn('Manifest lokal tidak tersedia; mencoba cadangan.', e);
    }

    const bounds = manifest?.bounds;
    const validBounds = bounds &&
      ['minX','minY','maxX','maxY'].every(k => Number.isFinite(Number(bounds[k]))) &&
      Number(bounds.maxX) > Number(bounds.minX) &&
      Number(bounds.maxY) > Number(bounds.minY) &&
      manifest.crs === 'EPSG:32751';

    try {
      await loadPreview(
        previewUrl + '?v=ortho-20261021',
        validBounds ? {
          minX:Number(bounds.minX), minY:Number(bounds.minY),
          maxX:Number(bounds.maxX), maxY:Number(bounds.maxY)
        } : knownBounds,
        'Pratinjau WebP ringan'
      );
      return;
    } catch (localError) {
      console.warn('Asset ortofoto dari Cloudflare gagal; mencoba GitHub raw.', localError);
    }

    await loadPreview(rawPreviewUrl + '?v=ortho-20261021', knownBounds, 'Pratinjau WebP dari GitHub');
  } catch (err) {
    console.error('Gagal memuat ortofoto baru:', err);
    setOrthoDetails('Ortofoto belum dapat dimuat', 'Periksa koneksi dan akses ke ortho_all_new_preview.webp.');
    toast('Ortofoto gagal dimuat. Periksa koneksi internet.');
  }
}

function loadClassLegend(){const el=els('classLegend');const labels={'OB/Waste':'OB/Waste','LLIM':'LLIM · Ni 1,15–1,30','HLIM':'HLIM · Ni ≥1,30','LGSO':'LGSO · Ni 1,25–1,45','MGSO':'MGSO · Ni 1,45–1,55','HGSO':'HGSO · Ni 1,55–1,65','VHGSO':'VHGSO · Ni ≥1,65','LIM <1.15':'LIM <1,15','SAP <1.25':'SAP <1,25'};el.innerHTML=classOrder.map(k=>`<div class="legend-item"><i class="swatch" style="background:${colors[k]}"></i>${labels[k]||k}</div>`).join('')}
app.raster.onload=()=>{
  app.rasterReady=app.raster.complete&&app.raster.naturalWidth>0&&app.raster.naturalHeight>0;
  if(!app.rasterReady){els('rasterStatus').textContent='Preview ortofoto tidak valid';draw();return}
  els('rasterStatus').textContent=`Preview ortofoto siap · ${app.raster.naturalWidth} × ${app.raster.naturalHeight}px · EPSG:32751`;
  canvasSize();
  // Fit to the combined raster and CSV extent regardless of which asset loads first.
  // This deliberately overrides stale localStorage camera state on startup.
  if(app.rows.length){app.viewRestored=false;app.viewTouched=false;fitData();app.initialFitDone=true}
  else if(!app.initialFitDone){fitData();app.initialFitDone=true}
  else draw();
};app.raster.onerror=()=>{app.rasterReady=false;els('rasterStatus').textContent='Preview ortofoto gagal dimuat · cek pit-preview.webp';toast('Preview ortofoto tidak ditemukan. Pastikan pit-preview.webp ada satu folder dengan index.html.');draw()};restoreProjectState();syncBlocksToggleUI();
loadClassLegend();
if(els('driveSyncBtn'))els('driveSyncBtn').addEventListener('click',()=>driveSyncLatest());
if(els('driveKeyBtn'))els('driveKeyBtn').addEventListener('click',configureDriveKey);
if(els('importOrthoTiffBtn'))els('importOrthoTiffBtn').addEventListener('click',()=>els('orthoTiffFile').click());
if(els('orthoTiffFile'))els('orthoTiffFile').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)convertImportedGeoTIFF(file);e.target.value=''});
setDriveStatus('Membaca snapshot lokal…');
app.raster.src = './ortho_all_new_preview.webp';
loadNewestDriveOrtho();
new ResizeObserver(()=>{canvasSize();if(!app.viewTouched&&app.rasterReady)fitData()}).observe(els('mapbox'));loadCsvUrl();
 setupOfflineApp();


/* ==========================================================
   MINE RESERVE 1.2.0 — FIELD PLOT / SECTION / GIS-CAD OVERLAY
   Modul tambahan. Tidak mengganti perhitungan fitur lama.
   ========================================================== */
(function addMineReserveFieldTools() {
  'use strict';

  const MR_KEY = 'minereserve-field-tools-v120';
  const MR_COLORS = [
    '#ffc85a', '#62d6c6', '#80adff',
    '#ff927a', '#cf9bff', '#b7e36b'
  ];

  let mode = 'pan';
  let points = [];
  let layers = [];
  let section = null;
  let previewLine = null;
  let drag = null;
  let sectionVisible = true;
  let sectionBlocks = [];
  let sectionHoles = [];
  let sectionWidth = 50;
  let sectionZoom = 1, sectionPanX = 0, sectionPanZ = 0;
  let sectionSurface = [], sectionDrag = null;

  const style = document.createElement('style');
  style.textContent = `
    #mrFieldTools .mrModes {
      display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px
    }
    #mrFieldTools .mrModes button { font-size:10px;padding:8px 3px }
    #mrFieldTools .mrModes button.active {
      border-color:var(--cyan);color:var(--cyan);background:#102726
    }
    #mrFieldTools .mrInfo {font-size:11px;color:var(--muted);line-height:1.55;margin:8px 0}
    #mrFieldTools .mrInput {width:100%;box-sizing:border-box;background:#0b1418;
      color:var(--text);border:1px solid #30434a;border-radius:8px;padding:9px}
    #mrFieldTools .mrLayer {border:1px solid #30434a;background:#0b1418;
      padding:9px;border-radius:9px;margin-top:7px}
    #mrFieldTools .mrLayerHead {display:grid;grid-template-columns:20px 26px 1fr;
      align-items:center;gap:7px}
    #mrFieldTools .mrLayerName {font-size:10px;overflow-wrap:anywhere}
    #mrFieldTools .mrLayerActions {display:flex;gap:5px;margin-top:7px}
    #mrFieldTools .mrLayerActions button {flex:1;font-size:10px;padding:6px}
    #mrFieldTools input[type=color] {width:26px;height:28px;border:0;background:none;padding:0}
    #mrSectionModal {display:none;position:fixed;inset:0;z-index:9999;
      background:#03080cee;padding:8px;align-items:center;justify-content:center}
    #mrSectionModal .mrSectionPanel {width:min(1400px,100%);max-height:96vh;
      overflow:auto;background:#10191e;color:#e8f0f2;border:1px solid #40565d;
      border-radius:12px;padding:12px}
    #mrSectionCanvas {width:100%;height:min(65vh,600px);min-height:290px;
      display:block;background:#0b1115;border:1px solid #30434a;border-radius:8px;touch-action:none;cursor:crosshair}
    #mrSectionModal .mrSectionTools{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}
    #mrSectionModal .mrSectionTools button{font-size:11px;padding:7px 10px}
    #mrSectionModal .mrSectionTools .active{border-color:var(--cyan);color:var(--cyan);background:#102726}
    #mrSectionModal .mrSectionLegend{font-size:10px;color:#b9cdd1;line-height:1.5;margin:4px 0 8px}
    #mrSectionInfo {font-size:11px;line-height:1.6;color:#c7d8db;margin-top:8px}
    @media(max-width:780px) {
      #mrSectionModal {padding:3px}
      #mrSectionModal .mrSectionPanel {padding:7px}
      #mrSectionCanvas {height:55vh;min-height:260px}
    }
  `;
  document.head.appendChild(style);

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) {
    console.error('Mine Reserve tools: sidebar tidak ditemukan.');
    return;
  }

  sidebar.insertAdjacentHTML('beforeend', `
    <section class="card" id="mrFieldTools">
      <div class="card-title">
        <h2>TOOLS LAPANGAN & GIS/CAD</h2>
        <span class="eyebrow">2.0.0</span>
      </div>

      <div class="mrModes">
        <button id="mrPan" class="active" type="button">Geser peta</button>
        <button id="mrPlot" type="button">Plot titik</button>
        <button id="mrSection" type="button">Garis penampang</button>
      </div>
      <div class="mrInfo" id="mrModeHelp">
        Pilih Plot titik untuk menambahkan lokasi, atau Garis penampang untuk menggambar penampang bebas. Mode polygon lama tetap tersedia.
      </div>

      <label class="field">
        <span>Lebar koridor penampang (meter)</span>
        <input class="mrInput" id="mrCorridor" type="number"
          min="1" max="1000" step="5" value="50">
      </label>

      <div class="button-row" style="margin-top:8px">
        <button id="mrShowSection" type="button" disabled>
          Lihat penampang
        </button>
        <button id="mrToggleSection" type="button">
          Sembunyikan garis
        </button>
      </div>

      <div class="field" style="margin-top:12px">
        <label>
          <input id="mrShowPoints" type="checkbox" checked style="width:auto">
          Tampilkan titik plot
        </label>
      </div>
      <div class="button-row" style="margin-top:7px">
        <button id="mrExportPoints" type="button">Ekspor titik CSV</button>
        <button id="mrClearPoints" type="button" class="danger">Hapus titik</button>
      </div>

      <div class="card-title" style="margin-top:16px">
        <h2>IMPORT GIS/CAD</h2>
        <span class="eyebrow">OVERLAY</span>
      </div>
      <div class="mrInfo">
        SHP harus dimasukkan sebagai ZIP berisi SHP, SHX, DBF dan PRJ.
        DXF mendukung beberapa entitas 2D umum. DWG perlu dikonversi ke DXF.
        CRS dan satuan harus diketahui sebelum layer dipakai.
      </div>

      <label class="field">
        <span>CRS koordinat file DXF</span>
        <select id="mrDxfCRS" class="mrInput">
          <option value="utm">UTM Zone 51S — EPSG:32751</option>
          <option value="wgs84">WGS 84 longitude / latitude</option>
        </select>
      </label>

      <input id="mrLayerFile" type="file" accept=".zip,.dxf,.dwg" class="hidden">
      <div class="button-row" style="margin-top:8px">
        <button id="mrImport" type="button" class="primary">＋ Impor layer</button>
        <button id="mrClearLayers" type="button">Hapus semua layer</button>
      </div>
      <div id="mrLayerStatus" class="mrInfo">Belum ada layer GIS/CAD.</div>
      <div id="mrLayerList"></div>
    </section>
  `);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="mrSectionModal" role="dialog" aria-modal="true">
      <div class="mrSectionPanel">
        <div class="card-title">
          <h2>PENAMPANG BLOK MODEL & BOR</h2>
          <div class="button-row" style="max-width:330px">
            <button id="mrExportSection" type="button">Ekspor CSV</button>
            <button id="mrCloseSection" type="button">Tutup</button>
          </div>
        </div>
        <div class="mrSectionTools"><button id="mrSectionZoomOut" type="button">− Zoom</button><button id="mrSectionZoomIn" type="button">＋ Zoom</button><button id="mrSectionZoomFit" type="button">Fit penampang</button><button id="mrMaterialAll" class="active" type="button">Semua material</button><button id="mrMaterialOB" type="button">OB saja</button><button id="mrMaterialSap" type="button">Saprolit saja</button><label style="font-size:11px;display:flex;align-items:center;gap:5px"><input id="mrGradeLabels" type="checkbox" checked style="width:auto"> Tampilkan kadar Ni/Fe</label></div>
        <div class="mrSectionLegend">Garis hijau terang = batas atas block model dari CSV reserve terbaru (Z tertinggi per kolom XY). Ini bukan pengukuran topo di antara block. Drag untuk menggeser; roda mouse/trackpad atau tombol zoom untuk memperbesar.</div>
        <canvas id="mrSectionCanvas" width="1400" height="650"></canvas>
        <div id="mrSectionInfo"></div>
        <div class="mrInfo">
          Sumbu horizontal adalah jarak sepanjang garis A–B. Sumbu vertikal adalah
          RL/elevasi. Interval assay ditampilkan berdasarkan From–To relatif terhadap
          RL collar. Data yang hilang tidak diinterpolasi.
        </div>
      </div>
    </div>
  `);

  const $ = id => document.getElementById(id);
  const safeName = s => String(s || 'Layer').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));

  function message(text) {
    $('mrLayerStatus').textContent = text;
  }

  function saveLocal() {
    try {
      const json = JSON.stringify({points, layers});
      if (json.length > 1800000) {
        localStorage.setItem(MR_KEY, JSON.stringify({points, layers:[]}));
        message('Titik tersimpan. Layer terlalu besar untuk disimpan lokal; ekspor/catat sumber layer sebelum menutup browser.');
      } else {
        localStorage.setItem(MR_KEY, json);
      }
    } catch (e) {
      message('Data ada di sesi ini, tetapi gagal disimpan permanen di browser: ' + e.message);
    }
  }

  try {
    const old = JSON.parse(localStorage.getItem(MR_KEY) || '{}');
    if (Array.isArray(old.points)) points = old.points;
    if (Array.isArray(old.layers)) layers = old.layers;
  } catch (e) {
    console.warn('Data lokal tools tidak dapat dibaca.', e);
  }

  function setMode(next) {
    mode = next;
    drag = null;
    previewLine = null;

    $('mrPan').classList.toggle('active', mode === 'pan');
    $('mrPlot').classList.toggle('active', mode === 'plot');
    $('mrSection').classList.toggle('active', mode === 'section');

    if (mode !== 'pan' && app.drawing) {
      endDrawMode();
    }

    $('mrModeHelp').textContent = mode === 'pan'
      ? 'Geser peta seperti biasa. Polygon dan tools lama tetap tersedia.'
      : mode === 'plot'
        ? 'Ketuk lokasi pada peta untuk menambahkan titik, label dan catatan.'
        : 'Tekan di titik awal lalu tarik garis ke titik akhir untuk membuat penampang.';

    canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
    draw();
  }

  // Transformasi WGS84 lon/lat ke UTM 51S dengan proj4.
  async function loadLibrary(url, test) {
    if (test()) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => test()
        ? resolve()
        : reject(new Error('Library dimuat tetapi API tidak tersedia.'));
      script.onerror = () => reject(new Error('Library gagal dimuat. Periksa internet.'));
      document.head.appendChild(script);
    });
  }

  async function ensureProjection() {
    await loadLibrary(
      'https://cdn.jsdelivr.net/npm/proj4@2.11.0/dist/proj4.js',
      () => typeof window.proj4 === 'function'
    );
    window.proj4.defs(
      'EPSG:32751',
      '+proj=utm +zone=51 +south +datum=WGS84 +units=m +no_defs +type=crs'
    );
  }

  function convertXY(x, y, geographic) {
    x = Number(x);
    y = Number(y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (!geographic) return {x, y};
    if (!window.proj4) throw new Error('Library proyeksi belum siap.');
    const p = window.proj4('EPSG:4326', 'EPSG:32751', [x, y]);
    return {x:p[0], y:p[1]};
  }

  function addPath(paths, coords, closed, geographic) {
    if (!Array.isArray(coords)) return;
    const pts = coords.map(p => convertXY(p[0], p[1], geographic)).filter(Boolean);
    if (pts.length) paths.push({pts, closed:!!closed});
  }

  function geoJSONToPaths(data) {
    const paths = [];
    function visit(obj) {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(visit);
        return;
      }
      if (obj.type === 'FeatureCollection') {
        (obj.features || []).forEach(visit);
        return;
      }
      if (obj.type === 'Feature') {
        visit(obj.geometry);
        return;
      }
      const c = obj.coordinates;
      switch (obj.type) {
        case 'Point':
          addPath(paths, [c], false, true);
          break;
        case 'MultiPoint':
          (c || []).forEach(p => addPath(paths, [p], false, true));
          break;
        case 'LineString':
          addPath(paths, c, false, true);
          break;
        case 'MultiLineString':
          (c || []).forEach(p => addPath(paths, p, false, true));
          break;
        case 'Polygon':
          (c || []).forEach(p => addPath(paths, p, true, true));
          break;
        case 'MultiPolygon':
          (c || []).forEach(poly => (poly || []).forEach(p => addPath(paths, p, true, true)));
          break;
        case 'GeometryCollection':
          (obj.geometries || []).forEach(visit);
          break;
      }
    }
    visit(data);
    return paths;
  }

  function parseDXF(text, geographic) {
    // Pembaca DXF ASCII untuk POINT, LINE, LWPOLYLINE, CIRCLE dan ARC.
    // Entitas 3D atau geometri khusus dapat memerlukan konversi terlebih dahulu.
    const raw = text.replace(/\r/g, '').split('\n');
    const pairs = [];
    for (let i=0; i+1<raw.length; i+=2) {
      const code = parseInt(raw[i].trim(), 10);
      if (Number.isFinite(code)) pairs.push({code, value:raw[i+1].trim()});
    }

    const entities = [];
    for (let i=0; i<pairs.length;) {
      if (pairs[i].code !== 0) { i++; continue; }
      const type = pairs[i].value.toUpperCase();
      i++;
      const values = [];
      while (i<pairs.length && pairs[i].code !== 0) values.push(pairs[i++]);
      entities.push({type, values});
    }

    const get = (e, code) => {
      const p = e.values.find(v => v.code === code);
      return p ? Number(p.value) : NaN;
    };
    const getAll = (e, code) => e.values.filter(v => v.code === code).map(v => Number(v.value));
    const xy = (x,y) => convertXY(x,y,geographic);
    const paths = [];

    for (let i=0; i<entities.length; i++) {
      const e = entities[i];

      if (e.type === 'POLYLINE') {
        const vertices = [];
        let j = i+1;
        for (; j<entities.length && entities[j].type !== 'SEQEND'; j++) {
          if (entities[j].type === 'VERTEX') {
            const p = xy(get(entities[j],10), get(entities[j],20));
            if (p) vertices.push(p);
          }
        }
        if (vertices.length) {
          const flags = get(e,70);
          paths.push({pts:vertices, closed:Number.isFinite(flags) && (flags & 1) === 1});
        }
        i = j;
        continue;
      }

      if (e.type === 'POINT') {
        const p = xy(get(e,10),get(e,20));
        if (p) paths.push({pts:[p],closed:false});
      } else if (e.type === 'LINE') {
        const a = xy(get(e,10),get(e,20));
        const b = xy(get(e,11),get(e,21));
        if (a && b) paths.push({pts:[a,b],closed:false});
      } else if (e.type === 'LWPOLYLINE') {
        const xs = getAll(e,10), ys = getAll(e,20), pts = [];
        for (let j=0;j<Math.min(xs.length,ys.length);j++) {
          const p = xy(xs[j],ys[j]);
          if (p) pts.push(p);
        }
        const flags = get(e,70);
        if (pts.length) paths.push({pts,closed:Number.isFinite(flags) && (flags & 1) === 1});
      } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
        const cx=get(e,10), cy=get(e,20), r=get(e,40);
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r<=0) continue;
        let start=e.type==='CIRCLE'?0:get(e,50)*Math.PI/180;
        let end=e.type==='CIRCLE'?Math.PI*2:get(e,51)*Math.PI/180;
        if (e.type==='ARC' && end < start) end += Math.PI*2;
        const n=48, pts=[];
        for (let j=0;j<=n;j++) {
          const a=start+(end-start)*j/n;
          const p=xy(cx+r*Math.cos(a),cy+r*Math.sin(a));
          if(p)pts.push(p);
        }
        if(pts.length)paths.push({pts,closed:e.type==='CIRCLE'});
      }
    }
    return paths;
  }

  function layerBounds(layer) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    (layer.paths || []).forEach(path => (path.pts || []).forEach(p => {
      minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
      maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
    }));
    return Number.isFinite(minX) ? {minX,minY,maxX,maxY} : null;
  }

  function renderLayerList() {
    const root=$('mrLayerList');
    if(!layers.length) {
      root.innerHTML='<div class="empty-state" style="margin-top:8px">Belum ada layer.</div>';
      return;
    }
    root.innerHTML=layers.map((l,i)=>`
      <div class="mrLayer">
        <div class="mrLayerHead">
          <input type="checkbox" data-mr-visible="${i}" ${l.visible?'checked':''} aria-label="Tampilkan layer">
          <input type="color" data-mr-color="${i}" value="${l.color||MR_COLORS[i%MR_COLORS.length]}" aria-label="Warna layer">
          <div class="mrLayerName">${safeName(l.name)}<br>
            <span style="color:#91a6ad">${(l.paths||[]).length} geometri</span>
          </div>
        </div>
        <div class="mrLayerActions">
          <button type="button" data-mr-fit="${i}">Fit layer</button>
          <button type="button" data-mr-delete="${i}" class="danger">Hapus</button>
        </div>
      </div>
    `).join('');
  }

  function drawOverlays() {
    ctx.save();

    if ($('mrShowPoints').checked) {
      points.forEach((p,i) => {
        const s=worldToScreen(p.x,p.y);
        if(s.x<-60 || s.x>app.viewW+60 || s.y<-60 || s.y>app.viewH+60) return;
        const color=p.color||MR_COLORS[i%MR_COLORS.length];
        ctx.beginPath();ctx.arc(s.x,s.y,6,0,Math.PI*2);
        ctx.fillStyle=color;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#10191e';ctx.stroke();
        ctx.font='bold 10px system-ui';
        const label=String(p.label||p.id).slice(0,50);
        const w=ctx.measureText(label).width;
        ctx.fillStyle='#091116e8';ctx.fillRect(s.x+9,s.y-11,w+8,16);
        ctx.fillStyle='#f0f6f7';ctx.fillText(label,s.x+13,s.y);
      });
    }

    layers.forEach(layer => {
      if(!layer.visible) return;
      ctx.strokeStyle=layer.color||'#62d6c6';
      ctx.fillStyle=layer.color||'#62d6c6';
      ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';
      (layer.paths||[]).forEach(path => {
        if(!path.pts || !path.pts.length) return;
        const pts=path.pts.map(p=>worldToScreen(p.x,p.y));
        ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
        for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
        if(path.closed && pts.length>2) {
          ctx.closePath();ctx.globalAlpha=.16;ctx.fill();ctx.globalAlpha=1;
        }
        ctx.stroke();
        if(pts.length===1) {
          ctx.beginPath();ctx.arc(pts[0].x,pts[0].y,4,0,Math.PI*2);ctx.fill();
        }
      });
    });

    function line(a,b,color) {
      if(!a||!b)return;
      const p=worldToScreen(a.x,a.y),q=worldToScreen(b.x,b.y);
      ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);
      ctx.setLineDash([8,5]);ctx.lineWidth=3;ctx.strokeStyle=color;ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.fill();
      ctx.font='bold 11px system-ui';ctx.fillText('A',p.x+7,p.y-7);ctx.fillText('B',q.x+7,q.y-7);
    }
    if(section && sectionVisible) line(section.a,section.b,'#66f0cf');
    if(previewLine) line(previewLine.a,previewLine.b,'#ffc85a');
    ctx.restore();
  }

  // Menggambar overlay setelah rendering map utama, bukan mengganti draw() lama.
  const originalDraw=draw;
  draw=function() {
    originalDraw();
    drawOverlays();
  };

  function addPoint(world) {
    const label=prompt('Nama/ID lokasi lapangan:', 'Titik '+(points.length+1));
    if(label===null)return;
    const note=prompt('Catatan lokasi (opsional):','')||'';
    points.push({
      id:'MR-'+Date.now().toString(36).toUpperCase(),
      label:String(label||('Titik '+(points.length+1))).trim(),
      note, x:world.x, y:world.y,
      crs:'EPSG:32751',
      color:MR_COLORS[points.length%MR_COLORS.length],
      createdAt:new Date().toISOString()
    });
    saveLocal();draw();message('Titik lapangan disimpan secara lokal.');
  }

  function lineInfo() {
    if(!section)return null;
    const dx=section.b.x-section.a.x,dy=section.b.y-section.a.y;
    const L=Math.hypot(dx,dy);
    if(!Number.isFinite(L)||L<0.1)return null;
    return {a:section.a,b:section.b,dx,dy,L,ux:dx/L,uy:dy/L};
  }

  function buildSection() {
    const info=lineInfo();
    sectionBlocks=[];sectionHoles=[];sectionSurface=[];
    if(!info){message('Garis penampang tidak valid. Gambar garis lebih panjang.');return;}

    sectionWidth=Math.max(1,Math.min(1000,Number($('mrCorridor').value)||50));
    const half=sectionWidth/2;

    for(let i=0;i<app.rows.length;i++) {
      const r=app.rows[i],vx=r.x-info.a.x,vy=r.y-info.a.y;
      const t=vx*info.ux+vy*info.uy;
      const perp=Math.abs(vx*info.uy-vy*info.ux);
      const alongHalf=DX/2*Math.abs(info.ux)+DY/2*Math.abs(info.uy);
      const perpHalf=DX/2*Math.abs(info.uy)+DY/2*Math.abs(info.ux);
      if(t>=-alongHalf && t<=info.L+alongHalf && perp<=half+perpHalf) {
        sectionBlocks.push({index:i,t:Math.max(0,Math.min(info.L,t)),row:r});
      }
    }

    for(const c of app.collars) {
      const vx=c.x-info.a.x,vy=c.y-info.a.y;
      const t=vx*info.ux+vy*info.uy;
      const perp=Math.abs(vx*info.uy-vy*info.ux);
      if(t>=0 && t<=info.L && perp<=half) {
        sectionHoles.push({
          collar:c,t,
          assays:app.assaysByHole.get(normalizeHoleId(c.id))||[]
        });
      }
    }

    const tops=new Map();sectionBlocks.forEach(b=>{const r=b.row,k=Number(r.x).toFixed(2)+'|'+Number(r.y).toFixed(2),old=tops.get(k);if(!old||r.z>old.row.z)tops.set(k,b)});
    sectionSurface=[...tops.values()].map(b=>({t:b.t,z:b.row.z+DZ/2})).sort((a,b)=>a.t-b.t);
    sectionZoom=1;sectionPanX=0;sectionPanZ=0;
    $('mrShowSection').disabled=false;
    renderSection();
    $('mrSectionModal').style.display='flex';
    message('Penampang: '+sectionBlocks.length+' blok dan '+sectionHoles.length+' collar dalam koridor '+sectionWidth+' m.');
  }

  function renderSection() {
    const c=$('mrSectionCanvas'),g=c.getContext('2d');
    const W=c.width,H=c.height,info=lineInfo();
    g.clearRect(0,0,W,H);g.fillStyle='#0b1115';g.fillRect(0,0,W,H);
    if(!info)return;

    let zmin=Infinity,zmax=-Infinity;
    sectionBlocks.forEach(b=>{
      zmin=Math.min(zmin,b.row.z-DZ/2);
      zmax=Math.max(zmax,b.row.z+DZ/2);
    });
    sectionHoles.forEach(h=>{
      const c0=h.collar;
      zmax=Math.max(zmax,c0.z);
      h.assays.forEach(a=>{
        zmin=Math.min(zmin,c0.z-a.to);
        zmax=Math.max(zmax,c0.z-a.from);
      });
      if(Number.isFinite(Number(c0.depth)))zmin=Math.min(zmin,c0.z-Number(c0.depth));
    });
    if(!Number.isFinite(zmin)||!Number.isFinite(zmax)) {
      zmin=app.allBounds?.minZ ?? 0;
      zmax=app.allBounds?.maxZ ?? 100;
    }
    if(zmax-zmin<1){zmin-=5;zmax+=5;}

    const left=68,right=24,top=28,bottom=50,L=Math.max(1,info.L);
    const pw=W-left-right,ph=H-top-bottom,zRange=Math.max(1,zmax-zmin);
    const fitScale=Math.max(0.0001,Math.min(pw/L,ph/zRange)),pxPerM=fitScale*sectionZoom;
    const usedW=L*pxPerM,usedH=zRange*pxPerM;
    const xOffset=left+(pw-usedW)/2-sectionPanX,yOffset=top+(ph-usedH)/2+sectionPanZ;
    const X=t=>xOffset+t*pxPerM,Y=z=>yOffset+(zmax-z)*pxPerM;

    g.font='12px system-ui';g.textAlign='right';g.textBaseline='middle';
    for(let i=0;i<=6;i++){
      const z=zmin+(zmax-zmin)*i/6,y=Y(z);
      g.strokeStyle='#2b3a40';g.beginPath();g.moveTo(left,y);g.lineTo(W-right,y);g.stroke();
      g.fillStyle='#c3d1d5';g.fillText(z.toFixed(1),left-8,y);
    }
    g.textAlign='center';g.textBaseline='top';
    for(let i=0;i<=8;i++){
      const d=L*i/8,x=X(d);
      g.strokeStyle='#26383e';g.beginPath();g.moveTo(x,top);g.lineTo(x,H-bottom);g.stroke();
      g.fillStyle='#c3d1d5';g.fillText(d.toFixed(0)+' m',x,H-bottom+8);
    }
    g.strokeStyle='#9aadb3';g.beginPath();g.moveTo(left,top);g.lineTo(left,H-bottom);g.lineTo(W-right,H-bottom);g.stroke();

    g.save();g.beginPath();g.rect(left,top,pw,ph);g.clip();
    const list=sectionBlocks.length>25000
      ?sectionBlocks.filter((b,i)=>i%Math.ceil(sectionBlocks.length/25000)===0)
      :sectionBlocks;

    list.forEach(b=>{
      const r=b.row;if(!materialVisible(r))return;
      const along=DX*Math.abs(info.ux)+DY*Math.abs(info.uy);
      const x=X(b.t),w=Math.max(1,along*pxPerM);
      const y=Y(r.z+DZ/2),h=Math.max(1,DZ*pxPerM);
      g.fillStyle=colors[r.cls]||'#aab5ba';g.globalAlpha=.85;
      g.fillRect(x-w/2,y,w,h);g.globalAlpha=1;
      if($('mrGradeLabels').checked&&w>=38&&h>=18){g.save();g.fillStyle='#071014';g.font='bold 10px ui-monospace,monospace';g.textAlign='center';g.textBaseline='middle';g.fillText('Ni '+Number(r.ni||0).toFixed(2)+'%',x,y+h/2-5);g.fillText('Fe '+Number(r.fe||0).toFixed(2)+'%',x,y+h/2+6);g.restore();}
    });
    if(sectionSurface.length>1){
      g.save();g.strokeStyle='#8dff65';g.lineWidth=2.5;g.shadowColor='#8dff65';g.shadowBlur=5;
      // Smooth small block-to-block elevation noise with a centered moving average.
      // Keep the source samples untouched; this is a display-only surface trace.
      const radius=2;
      const smooth=sectionSurface.map((p,i)=>{
        let sum=0,weight=0;
        for(let j=Math.max(0,i-radius);j<=Math.min(sectionSurface.length-1,i+radius);j++){
          const w=radius+1-Math.abs(j-i);sum+=sectionSurface[j].z*w;weight+=w;
        }
        return {t:p.t,z:sum/weight};
      });
      const pts=smooth.map(p=>({x:X(p.t),y:Y(p.z)}));
      g.beginPath();g.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length-1;i++){
        const mx=(pts[i].x+pts[i+1].x)/2,my=(pts[i].y+pts[i+1].y)/2;
        g.quadraticCurveTo(pts[i].x,pts[i].y,mx,my);
      }
      const last=pts[pts.length-1];g.lineTo(last.x,last.y);g.stroke();
      g.shadowBlur=0;g.fillStyle='#a8ff87';g.font='bold 11px system-ui';g.textAlign='left';g.textBaseline='bottom';
      const first=sectionSurface.find(p=>X(p.t)>=left&&X(p.t)<=W-right);
      if(first)g.fillText('TOP CSV '+first.z.toFixed(1)+' m',Math.max(left,X(first.t)+4),Math.max(top+12,Y(first.z)-4));
      g.restore();
    }

    sectionHoles.forEach(hole=>{
      const c0=hole.collar,x=X(hole.t);
      g.fillStyle='#d5e1e4';
      g.fillRect(x-3,Y(c0.z),6,Math.max(2,(Number(c0.depth)||20)/(zmax-zmin)*ph));

      hole.assays.forEach(a=>{
        const y1=Y(c0.z-a.from),y2=Y(c0.z-a.to);
        const yy=Math.max(top,Math.min(y1,y2)),hh=Math.max(1,Math.min(H-bottom,Math.max(y1,y2))-yy);
        if(y2<top||y1>H-bottom)return;
        g.fillStyle=lithologyColor(a.lithology);
        g.fillRect(x-5,yy,10,hh);
      });
      g.fillStyle='#ffc85a';g.font='bold 10px system-ui';
      g.textAlign='center';g.textBaseline='bottom';
      g.fillText(String(c0.id).slice(0,18),x,Math.max(top+10,Y(c0.z)-3));
    });
    g.restore();

    g.fillStyle='#d9e5e8';g.font='bold 12px system-ui';
    g.textAlign='left';g.textBaseline='top';g.fillText('RL / Elevasi (m)',8,8);
    g.textAlign='center';g.fillText('Jarak sepanjang garis A → B (m) · skala X/Z sama (1:1)',left+pw/2,H-18);
    $('mrSectionInfo').textContent=
      'Panjang garis: '+info.L.toFixed(2)+' m · Lebar koridor: '+sectionWidth+
      ' m · Blok: '+sectionBlocks.length+' · Collar: '+sectionHoles.length+
      ' · Interval assay: '+sectionHoles.reduce((n,h)=>n+h.assays.length,0)+
      ' · Filter: '+({all:'semua material',ob:'OB/Waste',sap:'Saprolit'}[app.materialFilter]||'semua material')+' · Zoom: '+sectionZoom.toFixed(1)+'× · batas atas CSV: '+sectionSurface.length+' titik. Tidak ada interpolasi geologi.';
  }

  function exportPoints() {
    const rows=[['ID','Label','Note','X_Easting_m','Y_Northing_m','CRS','Created_At']];
    points.forEach(p=>rows.push([p.id,p.label,p.note,p.x,p.y,p.crs,p.createdAt]));
    downloadCsv('Mine_Reserve_field_points.csv',rows);
  }

  function exportSection() {
    const info=lineInfo();
    if(!info){toast('Belum ada garis penampang.');return;}
    const rows=[['Record','Distance_From_A_m','X','Y','Z_or_RL','ID_or_Index','Material_or_Lithology','From_m','To_m','Ni_pct','Fe_pct','Corridor_m']];
    sectionBlocks.forEach(b=>{
      const r=b.row;
      rows.push(['BLOCK',b.t,r.x,r.y,r.z,b.index,r.cls,'','','','',sectionWidth]);
    });
    sectionHoles.forEach(h=>{
      const c=h.collar;
      h.assays.forEach(a=>rows.push([
        'ASSAY',h.t,c.x,c.y,c.z-a.from,c.id,a.lithology,a.from,a.to,a.ni,a.fe,sectionWidth
      ]));
      if(!h.assays.length)rows.push(['COLLAR',h.t,c.x,c.y,c.z,c.id,'','','','',sectionWidth]);
    });
    downloadCsv('Mine_Reserve_section.csv',rows);
  }

  async function importLayer(file) {
    const ext=file.name.toLowerCase().split('.').pop();
    if(file.size>100*1024*1024)throw new Error('Ukuran file di atas 100 MB. Sederhanakan data terlebih dahulu.');
    let paths=[];

    if(ext==='dwg') {
      throw new Error('DWG belum didukung secara langsung. Ekspor sebagai DXF dengan CRS dan satuan yang diketahui, lalu impor DXF.');
    }

    if(ext==='zip') {
      await ensureProjection();
      await loadLibrary(
        'https://unpkg.com/shpjs@6.2.0/dist/shp.min.js',
        ()=>typeof window.shp==='function'
      );
      // shpjs perlu menerima ZIP lengkap termasuk file PRJ untuk proyeksi yang benar.
      const data=await window.shp(await file.arrayBuffer());
      paths=geoJSONToPaths(data);
    } else if(ext==='dxf') {
      const crs=$('mrDxfCRS').value;
      if(crs==='wgs84')await ensureProjection();
      paths=parseDXF(await file.text(),crs==='wgs84');
    } else if(ext==='shp') {
      throw new Error('Pilih ZIP yang berisi SHP, SHX, DBF, dan PRJ sekaligus.');
    } else {
      throw new Error('Format tidak dikenali. Pilih ZIP Shapefile atau DXF.');
    }

    if(!paths.length)throw new Error('Tidak ada geometri yang bisa dibaca.');
    const vertexCount=paths.reduce((n,p)=>n+p.pts.length,0);
    if(vertexCount>80000)throw new Error('Terlalu banyak vertex ('+vertexCount+'). Sederhanakan geometri agar peta HP tetap responsif.');

    layers.push({
      name:file.name,paths,
      color:MR_COLORS[layers.length%MR_COLORS.length],
      visible:true
    });
    renderLayerList();saveLocal();draw();
    message('Layer '+file.name+' berhasil dibaca. Pastikan posisinya cocok dengan ortofoto dan CRS proyek.');
  }

  function fitLayer(i) {
    const b=layerBounds(layers[i]);
    if(!b)return;
    app.centerX=(b.minX+b.maxX)/2;
    app.centerY=(b.minY+b.maxY)/2;
    const w=Math.max(1,b.maxX-b.minX),h=Math.max(1,b.maxY-b.minY);
    app.scale=Math.max(.001,Math.min(5,(app.viewW-70)/w,(app.viewH-70)/h));
    app.viewTouched=true;draw();
  }

  $('mrPan').addEventListener('click',()=>setMode('pan'));
  $('mrPlot').addEventListener('click',()=>setMode('plot'));
  $('mrSection').addEventListener('click',()=>setMode('section'));
  $('mrShowPoints').addEventListener('change',draw);
  $('mrExportPoints').addEventListener('click',exportPoints);
  $('mrClearPoints').addEventListener('click',()=>{
    if(!confirm('Hapus semua titik plot lokal?'))return;
    points=[];saveLocal();draw();
  });
  $('mrCorridor').addEventListener('change',()=>{if(section)buildSection();});
  $('mrShowSection').addEventListener('click',buildSection);
  $('mrToggleSection').addEventListener('click',()=>{
    sectionVisible=!sectionVisible;
    $('mrToggleSection').textContent=sectionVisible?'Sembunyikan garis':'Tampilkan garis';
    draw();
  });
  $('mrCloseSection').addEventListener('click',()=>{$('mrSectionModal').style.display='none';});
  $('mrSectionModal').addEventListener('click',e=>{
    if(e.target===$('mrSectionModal'))$('mrSectionModal').style.display='none';
  });
  $('mrExportSection').addEventListener('click',exportSection);
  $('mrSectionZoomIn').addEventListener('click',()=>{sectionZoom=Math.min(8,sectionZoom*1.25);renderSection()});
  $('mrSectionZoomOut').addEventListener('click',()=>{sectionZoom=Math.max(.5,sectionZoom/1.25);renderSection()});
  $('mrSectionZoomFit').addEventListener('click',()=>{sectionZoom=1;sectionPanX=0;sectionPanZ=0;renderSection()});
  ['mrMaterialAll','mrMaterialOB','mrMaterialSap'].forEach((id,i)=>$(id).addEventListener('click',()=>setMaterialFilter(['all','ob','sap'][i])));
  $('mrGradeLabels').addEventListener('change',renderSection);
  const sectionCanvas=$('mrSectionCanvas');
  sectionCanvas.addEventListener('wheel',e=>{e.preventDefault();sectionZoom=Math.max(.5,Math.min(8,sectionZoom*(e.deltaY<0?1.18:1/1.18)));renderSection()},{passive:false});
  sectionCanvas.addEventListener('pointerdown',e=>{sectionDrag={x:e.clientX,y:e.clientY,panX:sectionPanX,panZ:sectionPanZ,id:e.pointerId};try{sectionCanvas.setPointerCapture(e.pointerId)}catch(_){}});
  sectionCanvas.addEventListener('pointermove',e=>{if(!sectionDrag||sectionDrag.id!==e.pointerId)return;const r=sectionCanvas.getBoundingClientRect();sectionPanX=sectionDrag.panX-(e.clientX-sectionDrag.x)*(sectionCanvas.width/r.width);sectionPanZ=sectionDrag.panZ+(e.clientY-sectionDrag.y)*(sectionCanvas.height/r.height);renderSection()});
  const endSectionDrag=e=>{if(sectionDrag&&sectionDrag.id===e.pointerId)sectionDrag=null};sectionCanvas.addEventListener('pointerup',endSectionDrag);sectionCanvas.addEventListener('pointercancel',endSectionDrag);
  syncMaterialFilterButtons();
  $('mrImport').addEventListener('click',()=>$('mrLayerFile').click());
  $('mrLayerFile').addEventListener('change',async e=>{
    const file=e.target.files && e.target.files[0];
    if(!file)return;
    message('Membaca '+file.name+'…');
    try{await importLayer(file);}
    catch(err){message('Impor gagal: '+err.message);alert('Impor GIS/CAD gagal: '+err.message);}
    e.target.value='';
  });
  $('mrClearLayers').addEventListener('click',()=>{
    if(!confirm('Hapus semua layer GIS/CAD?'))return;
    layers=[];saveLocal();renderLayerList();draw();
  });
  $('mrLayerList').addEventListener('change',e=>{
    if(e.target.dataset.mrVisible!==undefined) {
      layers[Number(e.target.dataset.mrVisible)].visible=e.target.checked;
    }
    if(e.target.dataset.mrColor!==undefined) {
      layers[Number(e.target.dataset.mrColor)].color=e.target.value;
    }
    saveLocal();draw();
  });
  $('mrLayerList').addEventListener('click',e=>{
    if(e.target.dataset.mrFit!==undefined)fitLayer(Number(e.target.dataset.mrFit));
    if(e.target.dataset.mrDelete!==undefined) {
      layers.splice(Number(e.target.dataset.mrDelete),1);
      saveLocal();renderLayerList();draw();
    }
  });

  function screenPos(e) {
    const r=document.getElementById('mapbox').getBoundingClientRect();
    const x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2,a=-mrMapRotation*Math.PI/180;
    return {x:r.width/2+x*Math.cos(a)-y*Math.sin(a),y:r.height/2+x*Math.sin(a)+y*Math.cos(a)};
  }

  // Capture hanya saat mode plot/section; mode normal tetap memakai handler lama.
  canvas.addEventListener('pointerdown',e=>{
    if(mode==='pan')return;
    e.preventDefault();e.stopImmediatePropagation();
    const p=screenPos(e);
    drag={start:p,last:p};
    try{canvas.setPointerCapture(e.pointerId);}catch(_){}
  },true);

  canvas.addEventListener('pointermove',e=>{
    if(!drag||mode==='pan')return;
    e.preventDefault();e.stopImmediatePropagation();
    const p=screenPos(e);
    drag.last=p;
    if(mode==='section') {
      previewLine={
        a:screenToWorld(drag.start.x,drag.start.y),
        b:screenToWorld(p.x,p.y)
      };
      draw();
    }
  },true);

  canvas.addEventListener('pointerup',e=>{
    if(!drag||mode==='pan')return;
    e.preventDefault();e.stopImmediatePropagation();
    const p=screenPos(e),start=drag.start;
    drag=null;previewLine=null;

    if(mode==='plot') {
      if(Math.hypot(p.x-start.x,p.y-start.y)<10) {
        addPoint(screenToWorld(p.x,p.y));
      }
    } else if(mode==='section') {
      if(Math.hypot(p.x-start.x,p.y-start.y)<10) {
        toast('Tarik garis lebih panjang untuk membuat penampang.');
        draw();return;
      }
      section={
        a:screenToWorld(start.x,start.y),
        b:screenToWorld(p.x,p.y)
      };
      sectionVisible=true;
      buildSection();
    }
    draw();
  },true);

  canvas.addEventListener('pointercancel',()=>{
    drag=null;previewLine=null;draw();
  },true);

  renderLayerList();
  draw();
})();
})();


(() => {
  const gpsPanel = document.getElementById('gpsPanel');
  const legend = document.querySelector('.mapbox .legend');
  const mapHead = document.querySelector('.map-head');
  const mapTitle = document.querySelector('.map-title');

  if (!gpsPanel || !legend || !mapHead || !mapTitle) {
    console.warn('Panel GPS atau legenda tidak ditemukan.');
    return;
  }

  // Gaya tombol dan kondisi panel yang dilipat.
  const style = document.createElement('style');
  style.textContent = `
    .mr-map-collapse-btn {
      pointer-events: auto !important;
      display: inline-grid;
      place-items: center;
      flex: 0 0 26px;
      width: 26px;
      min-width: 26px;
      height: 26px;
      padding: 0;
      border: 1px solid #557580;
      border-radius: 7px;
      background: #15262d;
      color: #c7f36a;
      font-size: 17px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
    }

    .map-head.is-collapsed {
      padding: 7px 12px;
      min-height: 46px;
      flex-wrap: nowrap;
      justify-content: flex-start;
    }

    .map-head.is-collapsed .toolbar {
      display: none !important;
    }

    .map-head.is-collapsed #mapSub {
      display: none !important;
    }

    .map-title .mr-map-head-toggle {
      margin-left: 4px;
    }

    .gps-panel.is-collapsed {
      width: max-content !important;
      min-width: 0;
      max-width: calc(100% - 16px);
      padding: 7px 9px;
    }

    .gps-panel.is-collapsed > :not(.gps-panel-head) {
      display: none !important;
    }

    .gps-panel.is-collapsed .gps-panel-head {
      margin-bottom: 0 !important;
      gap: 7px;
    }

    .gps-panel.is-collapsed .gps-panel-title {
      white-space: nowrap;
    }

    .legend .legend-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .legend .mr-legend-content {
      display: block;
    }

    .legend.is-collapsed {
      width: max-content;
      max-width: calc(100% - 24px);
      padding: 8px 10px;
    }

    .legend.is-collapsed .mr-legend-content {
      display: none !important;
    }

    .legend.is-collapsed .legend-title {
      margin-bottom: 0;
    }
  `;
  document.head.appendChild(style);

  function createToggle(panel, label, id) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'mr-map-collapse-btn';
    button.textContent = '−';
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Minimize ' + label);
    button.title = 'Minimize ' + label;

    button.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('is-collapsed');

      button.textContent = collapsed ? '+' : '−';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute(
        'aria-label',
        (collapsed ? 'Buka ' : 'Minimize ') + label
      );
      button.title =
        (collapsed ? 'Buka ' : 'Minimize ') + label;
    });

    return button;
  }

  // Tombol untuk melipat toolbar ORTHO + BLOCK MODEL agar area peta lebih luas.
  if (!document.getElementById('mrMapHeadCollapseToggle')) {
    const mapHeadToggle = createToggle(mapHead, 'menu ORTHO + BLOCK MODEL', 'mrMapHeadCollapseToggle');
    mapHeadToggle.classList.add('mr-map-head-toggle');
    mapTitle.appendChild(mapHeadToggle);
  }

  // Tombol minimize panel GPS.
  const gpsHeader = gpsPanel.querySelector('.gps-panel-head');

  if (gpsHeader && !document.getElementById('mrGpsCollapseToggle')) {
    gpsHeader.appendChild(
      createToggle(gpsPanel, 'panel GPS', 'mrGpsCollapseToggle')
    );
  }

  // Bungkus isi legenda agar hanya isinya yang disembunyikan.
  const legendTitle = legend.querySelector('.legend-title');

  if (
    legendTitle &&
    !legend.querySelector('.mr-legend-content')
  ) {
    const content = document.createElement('div');
    content.className = 'mr-legend-content';

    Array.from(legend.childNodes).forEach(node => {
      if (node !== legendTitle) {
        content.appendChild(node);
      }
    });

    legend.appendChild(content);
  }

  // Tombol minimize legenda material.
  if (
    legendTitle &&
    !document.getElementById('mrLegendCollapseToggle')
  ) {
    legendTitle.appendChild(
      createToggle(legend, 'legenda material', 'mrLegendCollapseToggle')
    );
  }
})();
