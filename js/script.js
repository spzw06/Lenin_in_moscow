// ==================== НАСТРОЙКИ ====================
const CSV_URL = (typeof window !== 'undefined' && window.DEF_CSV_URL) || 'data/lenin_monuments_coords.csv';

let map;
let markersCluster;
let allMonuments = [];
let currentFilter = 'all';
let markerMap = new Map();

// Инициализация карты
function initMap() {
    map = L.map('map').setView([55.7558, 37.6176], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
        subdomains: 'abcd', maxZoom: 18, minZoom: 10
    }).addTo(map);
    markersCluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
    map.addLayer(markersCluster);
}

// Иконка в зависимости от статуса
function getMarkerIcon(condition) {
    let color = '#95a5a6';
    if (condition === 'существует') color = '#2ecc71';
    else if (condition === 'утрачен') color = '#e74c3c';
    else color = '#f39c12';
    return L.divIcon({
        html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
        iconSize: [16, 16], className: 'custom-marker', popupAnchor: [0, -8]
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

function parseNumber(s) {
    if (s === undefined || s === null || s === '') return NaN;
    let str = String(s).trim();
    str = str.replace(',', '.');
    return parseFloat(str);
}

// Парсер CSV с разделителем ;
function parseCSV(csvText) {
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
    const lines = csvText.split(/\r?\n/);
    if (lines.length === 0) return [];
    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes(';')) delimiter = ';';
    
    function parseLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i+1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    }
    
    const headers = parseLine(lines[0]).map(h => {
        if (h.startsWith('"') && h.endsWith('"')) h = h.slice(1, -1);
        return h.toLowerCase();
    });
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;
        const values = parseLine(line);
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            let val = j < values.length ? values[j] : '';
            if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            }
            row[headers[j]] = val;
        }
        data.push(row);
    }
    return data;
}

// Новая функция: обработка распарсенных данных
function processDataFromCSV(data) {
    const keys = Object.keys(data[0]);
    console.log('Найденные столбцы:', keys);
    console.log('Пример первой строки:', data[0]);

    let validPoints = 0;
    let missingLat = 0, missingLon = 0, invalidCoord = 0;
    allMonuments = [];

    for (let idx = 0; idx < data.length; idx++) {
        const row = data[idx];
        let latValue = row['lat'] ?? row['latitude'] ?? row['широта'] ?? null;
        let lonValue = row['lon'] ?? row['lng'] ?? row['longitude'] ?? row['долгота'] ?? null;

        if (latValue === undefined || latValue === '') { missingLat++; continue; }
        if (lonValue === undefined || lonValue === '') { missingLon++; continue; }

        const lat = parseNumber(latValue);
        const lon = parseNumber(lonValue);
        if (isNaN(lat) || isNaN(lon)) { invalidCoord++; continue; }

        if (lat < 55.4 || lat > 56.1 || lon < 37.1 || lon > 37.9) {
            if (Math.abs(lat - 55.75) > 1.2 || Math.abs(lon - 37.62) > 1.2) continue;
        }

        let title = row['title'] || row['name'] || row['название'] || 'Памятник Ленину';
        const address = row['address'] || row['адрес'] || '';
        if (title === 'Памятник Ленину' && address) {
            title = `Памятник Ленину (${address.substring(0, 35)})`;
        }

        let condition = (row['condition'] || row['status'] || row['состояние'] || '').toLowerCase();
        if (condition === 'существует' || condition === 'exists' || condition === 'сохранился') condition = 'существует';
        else if (condition === 'утрачен' || condition === 'lost' || condition === 'демонтирован') condition = 'утрачен';
        else condition = 'не указано';

        const sculptor = row['sculptor'] || row['скульптор'] || '';
        const year = row['year'] || row['год'] || '';
        const description = row['description'] || row['описание'] || '';
        const material = row['material'] || row['материал'] || '';
        const heritage = row['heritage_status'] || row['охранный_статус'] || '';
        const typeInfo = row['type'] || row['тип'] || '';

        allMonuments.push({
            id: idx, lat, lon, title, address, condition,
            sculptor, year, description, material, heritage, typeInfo
        });
        validPoints++;
    }

    document.getElementById('totalCount').innerText = validPoints;
    if (validPoints === 0) {
        alert(`⚠️ Не найдено точек с координатами.\nСтолбцы: ${keys.join(', ')}\nСтатистика: нет lat у ${missingLat}, нет lon у ${missingLon}, нечисловые: ${invalidCoord}`);
        return;
    }

    console.log(`✅ Загружено ${validPoints} точек`);
    displayMonuments(allMonuments);
}

// Обычная загрузка через fetch (для GitHub Pages)
async function loadData() {
    const overlay = document.getElementById('loading-overlay');
    try {
        console.log('Загрузка CSV:', CSV_URL);
        const response = await fetch(CSV_URL);
        if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
        const csvText = await response.text();
        console.log('CSV получен, длина:', csvText.length);
        
        const data = parseCSV(csvText);
        if (!data.length) throw new Error('Нет данных в CSV');
        
        processDataFromCSV(data);
        overlay.style.display = 'none';
    } catch (err) {
        console.error(err);
        overlay.innerHTML = `<div class="error-message">❌ Ошибка: ${err.message}</div>`;
        setTimeout(() => overlay.style.display = 'none', 5000);
    }
}

function displayMonuments(monuments) {
    markersCluster.clearLayers();
    markerMap.clear();
    for (const mon of monuments) {
        const popupHtml = generatePopupHtml(mon);
        const marker = L.marker([mon.lat, mon.lon], { icon: getMarkerIcon(mon.condition) });
        marker.bindPopup(popupHtml);
        markersCluster.addLayer(marker);
        markerMap.set(mon.id, marker);
    }
    updateFilterCounter();
}

function generatePopupHtml(mon) {
    let conditionIcon = mon.condition === 'существует' ? '🟢' : (mon.condition === 'утрачен' ? '🔴' : '⚪');
    let html = `<strong>${escapeHtml(mon.title)}</strong><br>`;
    if (mon.address) html += `📍 ${escapeHtml(mon.address)}<br>`;
    html += `🏷 Состояние: ${conditionIcon} ${escapeHtml(mon.condition)}<br>`;
    if (mon.sculptor) html += `🎨 Скульптор: ${escapeHtml(mon.sculptor)}<br>`;
    if (mon.year) html += `📅 Год: ${escapeHtml(mon.year)}<br>`;
    if (mon.material) html += `🧱 Материал: ${escapeHtml(mon.material)}<br>`;
    if (mon.heritage) html += `🏛 Охрана: ${escapeHtml(mon.heritage)}<br>`;
    if (mon.typeInfo) html += `🏷 Тип: ${escapeHtml(mon.typeInfo)}<br>`;
    if (mon.description) html += `📖 ${escapeHtml(mon.description.substring(0, 120))}${mon.description.length > 120 ? '…' : ''}<br>`;
    html += `<i>Координаты: ${mon.lat.toFixed(5)}, ${mon.lon.toFixed(5)}</i>`;
    return html;
}

function applyFilter(filterValue) {
    currentFilter = filterValue;
    let filtered = filterValue === 'all' ? allMonuments : allMonuments.filter(m => m.condition === filterValue);
    displayMonuments(filtered);
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === filterValue) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function updateFilterCounter() {
    const allCount = allMonuments.length;
    const existsCount = allMonuments.filter(m => m.condition === 'существует').length;
    const lostCount = allMonuments.filter(m => m.condition === 'утрачен').length;
    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
    const existsBtn = document.querySelector('.filter-btn[data-filter="существует"]');
    const lostBtn = document.querySelector('.filter-btn[data-filter="утрачен"]');
    if (allBtn) allBtn.innerHTML = `Все точки (${allCount})`;
    if (existsBtn) existsBtn.innerHTML = `🟢 Существующие (${existsCount})`;
    if (lostBtn) lostBtn.innerHTML = `🔴 Утраченные (${lostCount})`;
}

function bindFilterButtons() {
    document.querySelector('.filter-btn[data-filter="all"]')?.addEventListener('click', () => applyFilter('all'));
    document.querySelector('.filter-btn[data-filter="существует"]')?.addEventListener('click', () => applyFilter('существует'));
    document.querySelector('.filter-btn[data-filter="утрачен"]')?.addEventListener('click', () => applyFilter('утрачен'));
    document.querySelector('.filter-btn[data-filter="reset"]')?.addEventListener('click', () => applyFilter('all'));
}

function init() {
    initMap();
    bindFilterButtons();
    // Если есть кастомная загрузка (например, из config.js), используем её
    if (typeof window.loadDataCustom === 'function') {
        window.loadDataCustom();
    } else {
        loadData();
    }
    window.addEventListener('resize', () => map?.invalidateSize());
}

// Делаем функции глобальными для доступа из config.js
window.parseCSV = parseCSV;
window.processDataFromCSV = processDataFromCSV;

init();