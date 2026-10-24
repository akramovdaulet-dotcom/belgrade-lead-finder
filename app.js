(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const status = $("status"), leadsEl = $("leads");
  let leads = [], map, markers;
  const categories = {
    food: [['amenity','restaurant'],['amenity','cafe'],['amenity','fast_food']],
    beauty: [['shop','hairdresser'],['shop','beauty'],['shop','barber']],
    restaurant: [['amenity','restaurant']], cafe: [['amenity','cafe']], barber: [['shop','barber']],
    all: [['amenity','restaurant'],['amenity','cafe'],['amenity','fast_food'],['shop','hairdresser'],['shop','beauty'],['shop','barber'],['shop','nail_salon']]
  };
  function say(msg, err=false){ status.textContent=msg; status.classList.toggle("error",err); }
  function safeText(v){ return String(v || "").trim(); }
  function initMap(lat=44.74, lon=20.45) {
    if (!window.L) { say("Карта не загрузилась. Список заведений всё ещё может работать.", true); return; }
    if (!map) {
      map = L.map("map").setView([lat,lon],13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom:19, attribution:'© OpenStreetMap contributors'}).addTo(map);
      markers = L.layerGroup().addTo(map);
    } else { map.setView([lat,lon],13); markers.clearLayers(); }
  }
  function link(label, href) {
    const a=document.createElement("a"); a.textContent=label; a.href=href; a.target="_blank"; a.rel="noopener noreferrer"; return a;
  }
  function phoneOf(t){ return t.phone || t["contact:phone"] || t["contact:mobile"] || ""; }
  function websiteOf(t){ return t.website || t["contact:website"] || t.url || ""; }
  function render() {
    leadsEl.replaceChildren();
    $("count").textContent=leads.length;
    $("withPhone").textContent=leads.filter(x=>phoneOf(x.tags)).length;
    $("withoutSite").textContent=leads.filter(x=>!websiteOf(x.tags)).length;
    $("exportBtn").disabled=!leads.length;
    if (!leads.length) { const d=document.createElement("div"); d.className="empty"; d.textContent="Ничего не найдено. Попробуй увеличить радиус или выбрать другую категорию."; leadsEl.append(d); return; }
    leads.forEach((l,i)=>{
      const t=l.tags||{}, name=safeText(t.name)||"Заведение без названия";
      const card=document.createElement("article"); card.className="lead";
      const top=document.createElement("div"); top.className="leadTop";
      const h=document.createElement("h3"); h.textContent=name; top.append(h);
      const badge=document.createElement("span"); badge.className="tag"; badge.textContent=websiteOf(t)?"Сайт указан":"Сайт не указан в OSM"; top.append(badge);
      card.append(top);
      const address=[t["addr:street"],t["addr:housenumber"],t["addr:suburb"],t["addr:city"]].filter(Boolean).join(" ");
      const meta=document.createElement("p"); meta.className="meta"; meta.textContent=[t.amenity||t.shop, address, phoneOf(t)].filter(Boolean).join(" · ") || "Адрес/телефон не внесён в OpenStreetMap"; card.append(meta);
      const links=document.createElement("div"); links.className="links";
      if(phoneOf(t)){ const tel=link("Позвонить","tel:"+phoneOf(t).replace(/[^\d+]/g,"")); links.append(tel); }
      if(websiteOf(t)){ let w=websiteOf(t); if(!/^https?:\/\//i.test(w)) w="https://"+w; links.append(link("Сайт",w)); }
      if(l.lat && l.lon) links.append(link("Маршрут","https://www.google.com/maps/dir/?api=1&destination="+l.lat+","+l.lon));
      links.append(link("Проверить в Google","https://www.google.com/search?q="+encodeURIComponent(name+" Belgrade")));
      links.append(link("Источник OSM","https://www.openstreetmap.org/"+l.type+"/"+l.id));
      const copy=document.createElement("button"); copy.type="button"; copy.textContent="Копировать лид";
      copy.addEventListener("click",async()=>{ const txt=[name,address,phoneOf(t),websiteOf(t),"https://www.google.com/search?q="+encodeURIComponent(name+" Belgrade")].filter(Boolean).join("\n"); try{await navigator.clipboard.writeText(txt);copy.textContent="Скопировано";}catch{copy.textContent="Копирование недоступно";} });
      links.append(copy); card.append(links); leadsEl.append(card);
      if(window.L && l.lat && l.lon){ const m=L.marker([l.lat,l.lon]).bindPopup(document.createTextNode(name)); m.on("click",()=>{}); markers.addLayer(m); }
    });
  }
  function queryFor(bbox, pairs, radiusPoint) {
    const [s,w,n,e]=bbox;
    const box=radiusPoint ? `(around:${radiusPoint.radius},${radiusPoint.lat},${radiusPoint.lon})` : `(${s},${w},${n},${e})`;
    const parts=[];
    for(const [key,val] of pairs){
      for(const kind of ["node","way","relation"]) parts.push(`${kind}["${key}"="${val}"]["name"]${box};`);
    }
    return `[out:json][timeout:25];(${parts.join("\n")});out center tags;`;
  }
  async function geocode(place){
    const u="https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(place);
    const r=await fetch(u,{headers:{"Accept":"application/json"}});
    if(!r.ok) throw new Error("Не удалось определить район. Проверь написание.");
    const a=await r.json(); if(!a.length) throw new Error("Район не найден. Попробуй указать город и страну.");
    return {lat:+a[0].lat,lon:+a[0].lon};
  }
  async function runSearch(center=null) {
    $("searchBtn").disabled=true; leads=[]; render(); say("Ищу в OpenStreetMap. Запрос может занять до 30 секунд…");
    try {
      const c=center||await geocode($("place").value.trim());
      initMap(c.lat,c.lon);
      const radius=+$("radius").value, pairs=categories[$("category").value]||categories.food;
      const dLat=radius/111320, dLon=radius/(111320*Math.cos(c.lat*Math.PI/180));
      const bbox=[c.lat-dLat,c.lon-dLon,c.lat+dLat,c.lon+dLon];
      const q=queryFor(bbox,pairs,{lat:c.lat,lon:c.lon,radius});
      const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:"data="+encodeURIComponent(q)});
      if(!r.ok) throw new Error("Сервер OpenStreetMap занят. Подожди минуту и попробуй снова.");
      const data=await r.json();
      const noSite=$("noWebsite").checked;
      const seen=new Set();
      leads=(data.elements||[]).map(el=>{
        const t=el.tags||{}, p=el.center||el;
        return {id:el.id,type:el.type,tags:t,lat:p.lat,lon:p.lon};
      }).filter(l=>{
        if(!l.tags.name||!Number.isFinite(l.lat)||!Number.isFinite(l.lon)) return false;
        const key=l.type+"/"+l.id;if(seen.has(key))return false;seen.add(key);
        if(noSite&&websiteOf(l.tags))return false;
        return true;
      }).sort((a,b)=>Number(!!phoneOf(b.tags))-Number(!!phoneOf(a.tags)));
      initMap(c.lat,c.lon); render();
      say(`Готово: ${leads.length} заведений. Проверь сайт каждого бизнеса вручную: данные OpenStreetMap могут быть неполными.`);
    } catch(e) { say(e.message||"Ошибка поиска.",true); }
    finally { $("searchBtn").disabled=false; }
  }
  $("searchBtn").addEventListener("click",()=>runSearch());
  $("locBtn").addEventListener("click",()=>{
    if(!navigator.geolocation){say("Этот браузер не поддерживает геолокацию.",true);return;}
    say("Запрашиваю разрешение на местоположение…");
    navigator.geolocation.getCurrentPosition(pos=>{
      const c={lat:pos.coords.latitude,lon:pos.coords.longitude};
      $("place").value=`Моё местоположение (${c.lat.toFixed(4)}, ${c.lon.toFixed(4)})`;
      runSearch(c);
    },()=>say("Геолокация не разрешена. Введи район вручную.",true),{enableHighAccuracy:false,timeout:10000});
  });
  $("exportBtn").addEventListener("click",()=>{
    const esc=v=>'"'+String(v??"").replace(/"/g,'""')+'"';
    const rows=[["name","category","address","phone","website","latitude","longitude","osm_url"]];
    leads.forEach(l=>{const t=l.tags||{};rows.push([t.name,t.amenity||t.shop,[t["addr:street"],t["addr:housenumber"],t["addr:suburb"],t["addr:city"]].filter(Boolean).join(" "),phoneOf(t),websiteOf(t),l.lat,l.lon,`https://www.openstreetmap.org/${l.type}/${l.id}`]);});
    const csv="\ufeff"+rows.map(row=>row.map(esc).join(",")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}), url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="belgrade-leads.csv";a.click();URL.revokeObjectURL(url);
  });
  initMap();
})();