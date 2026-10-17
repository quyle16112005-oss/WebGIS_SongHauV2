// file: app.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

class WebGISMonitor {
    constructor() {
        this.mapCoords = [10.045, 105.795];
        this.zoomLevel = 13;
        this.currentMode = 'temp'; 
        this.isScanning = true;
        this.measureActive = false;
        
        this.targets = {}; 
        this.zoneGeometries = {}; // Lưu tọa độ tĩnh của 20 vùng
        this.zoneData = {};       // Lưu dữ liệu môi trường Real-time của 20 vùng
        
        this.layers = { targetMarkers: {} };
        this.offsets = { lat: 0, lng: 0 };
        
        this.initFirebase();
        this.initMap();
        this.initGeometries(); // Tạo ranh giới 20 phân vùng
        this.generateLogicalMockData(); // Tạo dữ liệu giả lập có ý nghĩa địa lý
        this.initCharts();
        this.bindEvents();
        this.listenToRealTimeData();
        this.renderPolygons(); // Vẽ bản đồ lần đầu
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

    // TẠO LƯỚI KHÔNG GIAN TĨNH (20 POLYGON DỌC SÔNG HẬU)
    initGeometries() {
        const riverBanks = [
            { left: [10.092, 105.736], right: [10.098, 105.744] }, // Khúc 1: Thượng nguồn
            { left: [10.083, 105.748], right: [10.089, 105.756] }, 
            { left: [10.074, 105.762], right: [10.080, 105.771] }, // Khúc 3: Bắt đầu vào Cồn Khương
            { left: [10.064, 105.776], right: [10.070, 105.785] }, 
            { left: [10.054, 105.789], right: [10.060, 105.798] }, // Khúc 5: TT Ninh Kiều
            { left: [10.044, 105.800], right: [10.050, 105.809] }, 
            { left: [10.034, 105.810], right: [10.040, 105.819] }, // Khúc 7: Cầu Cần Thơ
            { left: [10.023, 105.818], right: [10.029, 105.828] }, // Khúc 8: Cảng Cái Cui
            { left: [10.011, 105.826], right: [10.017, 105.836] }, 
            { left: [9.999,  105.833], right: [10.005, 105.843] }  // Khúc 10: Thoát ra hạ lưu
        ];

        for (let i = 0; i < riverBanks.length - 1; i++) {
            let b1 = riverBanks[i];
            let b2 = riverBanks[i+1];
            let mid1 = [(b1.left[0] + b1.right[0])/2, (b1.left[1] + b1.right[1])/2];
            let mid2 = [(b2.left[0] + b2.right[0])/2, (b2.left[1] + b2.right[1])/2];

            // Vùng A: Bờ Cần Thơ (Luồng Tây Nam)
            this.zoneGeometries[`VUNG-S${i+1}A`] = { side: "Bờ Cần Thơ (Tây Nam)", coords: [b1.left, mid1, mid2, b2.left] };
            // Vùng B: Bờ Vĩnh Long (Luồng Đông Bắc)
            this.zoneGeometries[`VUNG-S${i+1}B`] = { side: "Bờ Vĩnh Long (Đông Bắc)", coords: [mid1, b1.right, b2.right, mid2] };
        }
    }

    // TẠO DỮ LIỆU ĐỊA LÝ LOGIC TRONG LÚC CHỜ FIREBASE
    generateLogicalMockData() {
        Object.keys(this.zoneGeometries).forEach(key => {
            const isCanThoSide = key.endsWith('A'); // Bờ Cần Thơ ô nhiễm hơn
            const segment = parseInt(key.replace('VUNG-S', '').replace('A', '').replace('B', ''));
            
            // Logic: Khúc 4, 5, 6 là trung tâm thành phố -> Nhiệt độ cao, DO thấp
            const isUrbanCore = (segment >= 4 && segment <= 6);
            // Logic: Khúc 8, 9 là cảng công nghiệp -> TSS cực cao
            const isIndustrial = (segment >= 8);

            let temp = 27.5 + (isUrbanCore ? 1.5 : 0) + (isCanThoSide ? 0.8 : 0) + Math.random()*0.5;
            let doVal = 6.8 - (isUrbanCore ? 1.2 : 0) - (isCanThoSide ? 0.6 : 0) + Math.random()*0.3;
            let tss = 25 + (segment * 1.5) + (isIndustrial ? 20 : 0) + (isCanThoSide ? 10 : 0) + Math.random()*5;

            this.zoneData[key] = { 
                temp: parseFloat(temp.toFixed(1)), 
                doVal: parseFloat(doVal.toFixed(1)), 
                tss: parseInt(tss) 
            };
        });
    }

    listenToRealTimeData() {
        // Lắng nghe dữ liệu vùng (Ghi đè dữ liệu giả lập nếu có kết nối Firebase)
        const zonesRef = ref(this.db, 'realtime/zoneData');
        onValue(zonesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                Object.keys(data).forEach(k => {
                    if(this.zoneData[k]) this.zoneData[k] = data[k];
                });
                if (this.isScanning) this.renderPolygons();
            }
        });

        // Lắng nghe trạm cá
        const targetsRef = ref(this.db, 'realtime/targets');
        onValue(targetsRef, (snapshot) => {
            if (!this.isScanning) return;
            if (snapshot.exists()) {
                this.targets = snapshot.val(); 
                this.updateTargetsOnMap();
            }
        });

        // Lắng nghe cảm biến cho biểu đồ
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

    getZoneColor(data) {
        if (this.currentMode === 'temp') return data.temp > 30 ? '#ff595e' : data.temp > 28.5 ? '#ffca3a' : '#2ec4b6';
        if (this.currentMode === 'do') return data.doVal < 5.2 ? '#ff595e' : data.doVal < 6 ? '#ffca3a' : '#2ec4b6';
        return data.tss > 55 ? '#ff595e' : data.tss > 40 ? '#ffca3a' : '#2ec4b6';
    }

    renderPolygons() {
        this.layers.polygonGroup.clearLayers();
        Object.keys(this.zoneGeometries).forEach(key => {
            const geo = this.zoneGeometries[key];
            const data = this.zoneData[key];
            if(!data) return;

            const shiftedCoords = geo.coords.map(pt => [pt[0] + this.offsets.lat, pt[1] + this.offsets.lng]);
            const color = this.getZoneColor(data);

            const poly = L.polygon(shiftedCoords, {
                fillColor: color, fillOpacity: 0.65, weight: 1.5, color: 'rgba(255,255,255,0.4)'
            }).addTo(this.layers.polygonGroup);
            
            poly.bindPopup(`
                <div class="custom-popup">
                    <div class="custom-popup-header" style="color: ${color};">
                        <i class="fa-solid fa-draw-polygon"></i> <span>Mã vùng: ${key}</span>
                    </div>
                    <div class="custom-popup-body">
                        <div class="data-row"><span class="data-label">Vị trí:</span><span class="data-value" style="color:#fff; font-size:11px;">${geo.side}</span></div>
                        <div class="data-row"><span class="data-label">Nhiệt độ nước:</span><span class="data-value" style="color:#ffca3a;">${data.temp} °C</span></div>
                        <div class="data-row"><span class="data-label">Oxy (DO):</span><span class="data-value" style="color:#2ec4b6;">${data.doVal} mg/L</span></div>
                        <div class="data-row" style="border:none;"><span class="data-label">Độ đục:</span><span class="data-value" style="color:#ff595e;">${data.tss} mg/L</span></div>
                    </div>
                </div>
            `);
            poly.on('mouseover', function() { this.setStyle({ fillOpacity: 0.9, weight: 2, color: '#fff' }); });
            poly.on('mouseout', function() { this.setStyle({ fillOpacity: 0.65, weight: 1.5, color: 'rgba(255,255,255,0.4)' }); });
        });
    }

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
                if(index === 0) tr.className = "active-row"; 
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
