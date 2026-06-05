// ==================== НАСТРОЙКИ ====================
const CSV_URL = (typeof window !== 'undefined' && window.DEF_CSV_URL) || 'data/lenin_monuments_coords.csv';

let map;
let markersCluster;
let allMonuments = [];
let currentFilter = 'all';
let markerMap = new Map();

// Хранилище SVG-иконок
let svgIcons = {
    фигура: null,
    бюст: null,
    'не указан': null
};

// Загрузка SVG-файлов
async function loadSvgIcons() {
    const basePath = 'data/assets/';
    const files = {
        фигура: 'f_type.svg',
        бюст: 'b_type.svg',
        'не указан': 'u_type.svg'
    };
    for (const [type, filename] of Object.entries(files)) {
        try {
            const response = await fetch(basePath + filename);
            if (response.ok) {
                svgIcons[type] = await response.text();
            } else {
                console.warn(`Не удалось загрузить иконку ${type}: ${response.status}`);
            }
        } catch (err) {
            console.warn(`Ошибка загрузки иконки ${type}:`, err);
        }
    }
}

// Получение цвета по статусу
function getColorByCondition(condition) {
    if (condition === 'утрачен') return '#555555';   // тёмно-серый (лучше виден на светлом)
    if (condition === 'существует') return '#cc0000'; // насыщенный тёмно-красный
    return '#e68a00';                                 // тёмно-оранжевый (вместо жёлтого)
}

// Создание маркера с иконкой на основе типа и статуса
function getMarkerIcon(type, condition) {
    // Определяем, какой SVG использовать
    let svgContent = null;
    if (type === 'фигура') svgContent = svgIcons.фигура;
    else if (type === 'бюст') svgContent = svgIcons.бюст;
    else svgContent = svgIcons['не указан'];
    
    const color = getColorByCondition(condition);
    
    if (svgContent) {
        // Заменяем цвет в SVG (ищем атрибуты fill и stroke)
        let coloredSvg = svgContent;
        // Простейшая замена: заменяем fill="..." и stroke="..." на нужный цвет
        coloredSvg = coloredSvg.replace(/fill="[^"]*"/g, `fill="${color}"`);
        coloredSvg = coloredSvg.replace(/stroke="[^"]*"/g, `stroke="${color}"`);
        // Если атрибуты без кавычек
        coloredSvg = coloredSvg.replace(/fill=[^ >]+/g, `fill="${color}"`);
        coloredSvg = coloredSvg.replace(/stroke=[^ >]+/g, `stroke="${color}"`);
        
        return L.divIcon({
            html: coloredSvg,
            iconSize: [28, 28],
            className: 'custom-svg-marker',
            popupAnchor: [0, -14]
        });
    } else {
        // fallback – цветной кружок
        return L.divIcon({
            html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
            iconSize: [18, 18],
            className: 'custom-marker',
            popupAnchor: [0, -9]
        });
    }
}

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

// Парсер CSV с поддержкой кавычек и переводов строк
function parseCSV(csvText) {
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
    
    let delimiter = ';';
    const firstLineEnd = csvText.indexOf('\n');
    if (firstLineEnd !== -1) {
        const firstLine = csvText.substring(0, firstLineEnd);
        if (firstLine.includes(',')) delimiter = ',';
        else if (firstLine.includes(';')) delimiter = ';';
    }
    
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;
    const len = csvText.length;
    
    while (i < len) {
        const ch = csvText[i];
        if (ch === '"') {
            if (inQuotes && csvText[i+1] === '"') {
                currentField += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if (ch === '\n' && !inQuotes) {
            currentRow.push(currentField.trim());
            rows.push(currentRow);
            currentRow = [];
            currentField = '';
        } else {
            currentField += ch;
        }
        i++;
    }
    if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }
    
    if (rows.length === 0) return [];
    
    const headers = rows[0].map(h => {
        let clean = h;
        if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
        return clean.toLowerCase();
    });
    
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length === 1 && row[0] === '') continue;
        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            let val = j < row.length ? row[j] : '';
            if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1);
            }
            obj[headers[j]] = val.trim();
        }
        data.push(obj);
    }
    return data;
}

// Обработка данных из CSV
function processDataFromCSV(data) {
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

        let title = (row['title'] || row['name'] || row['название'] || 'Памятник Ленину').trim();
        const address = (row['address'] || row['адрес'] || '').trim();
        if (title === 'Памятник Ленину' && address) {
            title = `Памятник Ленину (${address.substring(0, 35)})`;
        }

        // Статус
        let rawCondition = row['condition'] || row['состояние'] || row['status'] || '';
        let cleaned = rawCondition.toString().normalize('NFKC')
            .replace(/[\uFEFF\u200B\u00A0]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        
        let condition = 'не указано';
        if (cleaned === 'существует' || cleaned === 'exists' || cleaned === 'сохранился') condition = 'существует';
        else if (cleaned === 'утрачен' || cleaned === 'lost' || cleaned === 'демонтирован') condition = 'утрачен';
        else if (cleaned.includes('утра')) condition = 'утрачен';
        else if (cleaned.includes('существу')) condition = 'существует';

        // Тип памятника (для иконки)
        let monumentType = (row['type'] || row['тип'] || 'не указан').trim().toLowerCase();
        if (monumentType !== 'фигура' && monumentType !== 'бюст') monumentType = 'не указан';

        // Парсинг photo_urls (как в вашем коде)
        let photoUrls = [];
        const rawPhoto = row['photo_urls'] || '';
        if (rawPhoto.trim() !== '') {
            photoUrls = rawPhoto.split(',').map(f => f.trim()).filter(f => f !== '');
            photoUrls = photoUrls.map(f => `data/images/${f}`);
        }

        const sculptor = (row['sculptor'] || row['скульптор'] || '').trim();
        const year = (row['year'] || row['год'] || '').trim();
        const description = (row['description'] || row['описание'] || '').trim();
        const material = (row['material'] || row['материал'] || '').trim();
        const heritage = (row['heritage_status'] || row['охранный_статус'] || '').trim();
        const typeInfo = (row['type'] || row['тип'] || '').trim(); // сохраняем оригинал для попапа

        allMonuments.push({
            id: idx, lat, lon, title, address, condition,
            sculptor, year, description, material, heritage, typeInfo,
            monumentType: monumentType, // используем для иконки
            photoUrls: photoUrls
        });
        validPoints++;
    }

    document.getElementById('totalCount').innerText = validPoints;
    if (validPoints === 0) {
        alert('⚠️ Не найдено точек с координатами. Проверьте наличие столбцов lat/lon в CSV.');
        return;
    }
    displayMonuments(allMonuments);
}

// Отображение маркеров с новыми иконками
function displayMonuments(monuments) {
    markersCluster.clearLayers();
    markerMap.clear();
    for (const mon of monuments) {
        const popupHtml = generatePopupHtml(mon);
        const icon = getMarkerIcon(mon.monumentType, mon.condition);
        const marker = L.marker([mon.lat, mon.lon], { icon: icon });
        marker.bindPopup(popupHtml);
        markersCluster.addLayer(marker);
        markerMap.set(mon.id, marker);
    }
    updateFilterCounter();
}

// Генерация HTML для попапа (без изменений, кроме удаления старой иконки)
function generatePopupHtml(mon) {
    let conditionIcon = mon.condition === 'существует' ? '🟢' : (mon.condition === 'утрачен' ? '🔴' : '⚪');
    let html = `<div class="popup-container">`;
    html += `<strong>${escapeHtml(mon.title)}</strong><br>`;
    if (mon.address) html += `📍 ${escapeHtml(mon.address)}<br>`;
    html += `🏷 Состояние: ${conditionIcon} ${escapeHtml(mon.condition)}<br>`;
    if (mon.sculptor) html += `🎨 Скульптор: ${escapeHtml(mon.sculptor)}<br>`;
    if (mon.year) html += `📅 Год: ${escapeHtml(mon.year)}<br>`;
    if (mon.material) html += `🧱 Материал: ${escapeHtml(mon.material)}<br>`;
    if (mon.heritage) html += `🏛 Охрана: ${escapeHtml(mon.heritage)}<br>`;
    if (mon.typeInfo) html += `🏷 Тип: ${escapeHtml(mon.typeInfo)}<br>`;
    if (mon.description) html += `📖 ${escapeHtml(mon.description.substring(0, 120))}${mon.description.length > 120 ? '…' : ''}<br>`;
    html += `<i>Координаты: ${mon.lat.toFixed(5)}, ${mon.lon.toFixed(5)}</i><br>`;
    
    if (mon.photoUrls && mon.photoUrls.length > 0) {
        html += `<div class="photo-gallery">`;
        for (let i = 0; i < mon.photoUrls.length; i++) {
            const imgPath = mon.photoUrls[i];
            html += `<img src="${imgPath}" alt="Фото памятника" class="gallery-thumb" data-full="${imgPath}" loading="lazy">`;
        }
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}

// Загрузка данных (без изменений)
async function loadData() {
    const overlay = document.getElementById('loading-overlay');
    try {
        const response = await fetch(CSV_URL);
        if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
        const csvText = await response.text();
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

// Модальное окно для полноэкранного просмотра изображений
function initLightbox() {
    // Создаём элементы модального окна
    const modal = document.createElement('div');
    modal.id = 'lightbox-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="lightbox-content">
            <span class="lightbox-close">&times;</span>
            <img class="lightbox-img" src="" alt="Полноразмерное изображение">
        </div>
    `;
    document.body.appendChild(modal);
    
    const modalImg = modal.querySelector('.lightbox-img');
    const closeBtn = modal.querySelector('.lightbox-close');
    
    // Обработчик клика на миниатюрах (делегирование)
    document.addEventListener('click', (e) => {
        const thumb = e.target.closest('.gallery-thumb');
        if (thumb && thumb.dataset.full) {
            e.preventDefault();
            modal.style.display = 'flex';
            modalImg.src = thumb.dataset.full;
        }
    });
    
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        modalImg.src = '';
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modalImg.src = '';
        }
    });
}
async function init() {
    initMap();
    bindFilterButtons();
    initLightbox();
    await loadSvgIcons();      // загружаем иконки перед отображением
    if (typeof window.loadDataCustom === 'function') {
        window.loadDataCustom();
    } else {
        loadData();
    }
    window.addEventListener('resize', () => map?.invalidateSize());
}

window.parseCSV = parseCSV;
window.processDataFromCSV = processDataFromCSV;
init();