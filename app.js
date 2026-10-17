// file: app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

class WebGISMonitor {
    constructor() {
        this.mapCoords = [10.045, 105.795];
        this.zoomLevel = 13;
        this.currentMode = 'temp'; 
        this.isScanning = true;
        this.measureActive = false;
        
        this.riverZones = [];
        this.targets = {}; 
        
        this.layers = { targetMarkers: {} };
        this.offsets = { lat: 0, lng: 0 };
        
        this.initFirebase();
        this.initMap();
        this.initCharts();
        this.loadStaticData(); 
        this.bindEvents();
        this.listenToRealTimeData();
    }

    initFirebase() {
        const firebaseConfig = {
            apiKey: "AIzaSyAG0RMR1floLIFb6UszyAUrYfjblx8p0Bg",
            authDomain: "webgissonghauv2.firebaseapp.com",
            databaseURL: "https://webgissonghauv2-default-rtdb.firebaseio.com",
            projectId: "webgissonghauv2",
            storageBucket: "webgissonghauv2.firebasestorage.app",
            messagingSenderId: "847857147478",
            appId: "1:847857147478:web:5ec5fadc14a4192a2265f7"
        };
        const app = initializeApp(firebaseConfig);
        this.db = getDatabase(app);
    }

    initMap() {
        this.map = L.map('map', {zoomControl: false}).setView(this.mapCoords, this.zoomLevel);
        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        this.basemaps = {
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 }),
            osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }),
            topo: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18 })
        };
        this.currentBasemap = 'satellite';
        this.basemaps[this.currentBasemap].addTo(this.map);

        this.layers.aiGroup = L.layerGroup().addTo(this.map);
        this.layers.polygonGroup = L.layerGroup().addTo(this.layers.aiGroup);
        this.layers.targetGroup = L.layerGroup().addTo(this.layers.aiGroup);
        this.measureMarker = null;
    }

    loadStaticData() {
        const zonesRef = ref(this.db, 'staticData/riverZones');
        get(zonesRef).then((snapshot) => {
            if (snapshot.exists()) {
                this.riverZones = snapshot.val();
                this.renderPolygons();
            }
        });
    }

    // KHÔI PHỤC LẮNG NGHE ĐỦ 3 BIỂU ĐỒ (DO, TSS, FLOW)
    listenToRealTimeData() {
        const targetsRef = ref(this.db, 'realtime/targets');
        onValue(targetsRef, (snapshot) => {
            if (!this.isScanning) return;
            const data = snapshot.val();
            if (data) {
                this.targets = data; 
                this.updateTargetsOnMap();
            }
        });

        onValue(ref(this.db, 'realtime/sensors/do/currentValue'), (snapshot) => {
            if (!this.isScanning || snapshot.val() === null) return;
            this.updateChartData(this.charts.do, snapshot.val());
            document.getElementById('avg-do').innerText = parseFloat(snapshot.val()).toFixed(1) + ' mg/L';
        });

        onValue(ref(this.db, 'realtime/sensors/tss/currentValue'), (snapshot) => {
            if (!this.isScanning || snapshot.val() === null) return;
            this.updateChartData(this.charts.tss, snapshot.val());
            document.getElementById('avg-tss').innerText = parseInt(snapshot.val()) + ' mg/L';
        });

        onValue(ref(this.db, 'realtime/sensors/flow/currentValue'), (snapshot) => {
            if (!this.isScanning || snapshot.val() === null) return;
            this.updateChartData(this.charts.flow, snapshot.val());
        });
    }

    getZoneColor(zone) {
        if (this.currentMode === 'temp') return zone.temp > 30 ? '#ff595e' : zone.temp > 28.5 ? '#ffca3a' : '#2ec4b6';
        if (this.currentMode === 'do') return zone.doVal < 5.2 ? '#ff595e' : zone.doVal < 6 ? '#ffca3a' : '#2ec4b6';
        return zone.tss > 55 ? '#ff595e' : zone.tss > 35 ? '#ffca3a' : '#2ec4b6';
    }

    renderPolygons() {
        this.layers.polygonGroup.clearLayers();
        this.riverZones.forEach(zone => {
            const shiftedCoords = zone.coords.map(pt => [pt[0] + this.offsets.lat, pt[1] + this.offsets.lng]);
            const poly = L.polygon(shiftedCoords, {
                fillColor: this.getZoneColor(zone), fillOpacity: 0.6, weight: 1, color: '#fff'
            }).addTo(this.layers.polygonGroup);
            
            // Khôi phục popup Polygon chi tiết
            poly.bindPopup(`
                <div class="custom-popup">
                    <div class="custom-popup-header" style="color: ${this.getZoneColor(zone)};">
                        <i class="fa-solid fa-draw-polygon"></i> <span>Phân Vùng: ${zone.id}</span>
                    </div>
                    <div class="custom-popup-body">
                        <div class="data-row"><span class="data-label">Vị trí:</span><span class="data-value" style="color:#fff; font-size:11px;">${zone.side || 'Lòng sông'}</span></div>
                        <div class="data-row"><span class="data-label">Nhiệt độ nước:</span><span class="data-value" style="color:#ffca3a;">${zone.temp} °C</span></div>
                        <div class="data-row"><span class="data-label">Oxy (DO):</span><span class="data-value" style="color:#2ec4b6;">${zone.doVal} mg/L</span></div>
                        <div class="data-row" style="border:none;"><span class="data-label">Độ đục:</span><span class="data-value" style="color:#ff595e;">${zone.tss} mg/L</span></div>
                    </div>
                </div>
            `);
            poly.on('mouseover', function() { this.setStyle({ fillOpacity: 0.85, weight: 2, color: '#fff' }); });
            poly.on('mouseout', function() { this.setStyle({ fillOpacity: 0.6, weight: 1, color: '#fff' }); });
        });
    }

    // KHÔI PHỤC HIỂN THỊ POPUP CHI TIẾT CỦA CÁ/LỒNG BÈ
    createTargetPopup(t, dispLat, dispLng) {
        return `
            <div class="custom-popup">
                <div class="custom-popup-header" style="color: ${t.color || '#ffca3a'};">
                    <i class="fa-solid fa-fish"></i> <span>Mã trạm: ${t.id}</span>
                </div>
                <div class="custom-popup-body">
                    <div class="data-row"><span class="data-label">Đối tượng:</span><span class="data-value" style="color:#fff;">${t.name}</span></div>
                    <div class="data-row"><span class="data-label">Độ tin cậy AI:</span><span class="data-value" style="color:var(--accent-color);">${t.acc || 0}%</span></div>
                    <div class="data-row"><span class="data-label">Độ sâu:</span><span class="data-value" style="color:#ffca3a;">${t.depth || 0} m</span></div>
                    <div class="data-row"><span class="data-label">Vận tốc bơi:</span><span class="data-value">${t.speed || 0} m/s</span></div>
                    <div class="data-row" style="border:none;"><span class="data-label">Tọa độ GPS:</span><span class="data-value" style="color:var(--active-color);">${dispLng.toFixed(4)}°E, ${dispLat.toFixed(4)}°N</span></div>
                </div>
            </div>
        `;
    }

    updateTargetsOnMap() {
        const tbody = document.getElementById('table-body');
        if(tbody) tbody.innerHTML = '';

        Object.keys(this.targets).forEach((key, index) => {
            const t = this.targets[key];
            const lat = t.lat + this.offsets.lat;
            const lng = t.lng + this.offsets.lng;
            const targetColor = t.color || (t.type === 'fish' ? '#ffca3a' : '#ff595e');

            if (this.layers.targetMarkers[key]) {
                this.layers.targetMarkers[key].setLatLng([lat, lng]);
                this.layers.targetMarkers[key].setPopupContent(this.createTargetPopup(t, lat, lng));
            } else {
                this.layers.targetMarkers[key] = L.circleMarker([lat, lng], { radius: 8, fillColor: targetColor, weight: 2, color: '#fff', fillOpacity: 1 })
                    .addTo(this.layers.targetGroup)
                    .bindPopup(this.createTargetPopup(t, lat, lng));
            }
            
            if(tbody) {
                const tr = document.createElement('tr');
                if(index === 0) tr.className = "active-row"; // Dòng đầu tiên active
                tr.innerHTML = `
                    <td style="font-weight:bold;">${t.id}</td>
                    <td><span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:10px;">${t.typeName || 'Khác'}</span></td>
                    <td id="coord-${t.id}" style="color:${targetColor}; font-family:monospace; font-size:11px;">${lng.toFixed(4)}°E, ${lat.toFixed(4)}°N</td>
                `;
                tr.onclick = () => { 
                    document.querySelectorAll('.catch-table tr').forEach(row => row.classList.remove('active-row'));
                    tr.classList.add('active-row');
                    this.map.flyTo([lat, lng], 15); 
                    setTimeout(() => { this.layers.targetMarkers[key].openPopup(); }, 800);
                };
                tbody.appendChild(tr);
            }
        });
    }

    bindEvents() {
        this.map.on('click', (e) => {
            if (!this.measureActive) return;
            if (this.measureMarker) this.map.removeLayer(this.measureMarker);
            
            const simTemp = (28.2 + Math.random() * 2.2).toFixed(1);
            const simDO = (5.2 + Math.random() * 1.5).toFixed(2);
            
            this.measureMarker = L.circleMarker(e.latlng, { radius: 9, fillColor: '#00f5d4', color: '#fff', weight: 3, fillOpacity: 1 })
                .addTo(this.map)
                .bindPopup(`
                    <div class="custom-popup">
                        <div class="custom-popup-header" style="color: #00f5d4;">
                            <i class="fa-solid fa-flask"></i> <span>Kết Quả Trạm Đo Nhanh</span>
                        </div>
                        <div class="custom-popup-body">
                            <div class="data-row"><span class="data-label">Tọa độ đo:</span><span class="data-value">${e.latlng.lng.toFixed(4)}°E, ${e.latlng.lat.toFixed(4)}°N</span></div>
                            <div class="data-row"><span class="data-label">Nhiệt độ:</span><span class="data-value" style="color:#ffca3a;">${simTemp} °C</span></div>
                            <div class="data-row" style="border:none;"><span class="data-label">Oxy (DO):</span><span class="data-value" style="color:#2ec4b6;">${simDO} mg/L</span></div>
                        </div>
                    </div>
                `).openPopup();
        });

        const toggleAI = document.getElementById('toggleAI');
        if(toggleAI) {
            toggleAI.addEventListener('change', (e) => {
                this.isScanning = e.target.checked;
                this.isScanning ? this.map.addLayer(this.layers.aiGroup) : this.map.removeLayer(this.layers.aiGroup);
            });
        }
    }

    // KHÔI PHỤC CẤU HÌNH ĐỦ 3 BIỂU ĐỒ 
    initCharts() {
        const createChart = (canvasId, color, min, max, initData) => {
            const canvas = document.getElementById(canvasId);
            if(!canvas) return null;
            return new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels: ['1','2','3','4','5','6','7','8','9','10'], datasets: [{ data: initData, borderColor: color, backgroundColor: color + '25', fill: true, borderWidth: 2, pointRadius: 0, tension: 0.4 }] },
                options: { responsive: true, maintainAspectRatio: false, animation: { duration: 0 }, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false, min: min, max: max } } }
            });
        };
        this.charts = { 
            do: createChart('chart1', '#2ec4b6', 4, 8, [5.5,5.8,5.7,6.0,5.9,5.8,5.4,5.6,5.8,5.7]),
            tss: createChart('chart2', '#ff595e', 20, 70, [38,42,40,45,48,44,41,39,42,43]),
            flow: createChart('chart3', '#ffca3a', 0.2, 1.5, [0.8,0.85,0.7,0.9,1.0,0.85,0.8,0.75,0.8,0.88])
        };
    }

    updateChartData(chartInstance, newValue) {
        if(!chartInstance) return;
        chartInstance.data.datasets[0].data.shift();
        chartInstance.data.datasets[0].data.push(parseFloat(newValue));
        chartInstance.update();
    }
}

window.appGIS = new WebGISMonitor();
