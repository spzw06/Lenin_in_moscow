// ==================== НАСТРОЙКИ ====================
const CSV_URL = (typeof window !== 'undefined' && window.DEF_CSV_URL) || 'data/lenin_monuments_coords.csv';

// Яндекс-слой отключён: ключ API отсутствовал/был невалиден,
// карта всегда рисуется на OSM/CartoDB (см. createOsmMap)

let map;
let markersCluster;
let allMonuments = [];
let currentFilter = 'all';
let markerMap = new Map();
let photoAttribution = {}; // словарь: имя файла -> { author, source, title }
let sidebarVisible = false;
let searchQuery = '';
let currentFilteredList = [];
let filterType = 'all';
let filterMaterial = 'all';
let filterSculptor = 'all';
let filterPhoto = 'all';
let pendingMonumentId = null;   // для запроса, если данные ещё не загружены

window.allMonuments = [];

// Хранилище SVG-иконок
let svgIcons = {
    фигура: null,
    бюст: null,
    'не указан': null
};

console.log('🧩 pendingMonumentId инициализирован:', pendingMonumentId);

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
    if (condition === 'утрачен') return '#555555';
    if (condition === 'существует') return '#cc0000';
    return '#e68a00';
}

// Создание маркера
function getMarkerIcon(type, condition) {
    let svgContent = null;
    if (type === 'фигура') svgContent = svgIcons.фигура;
    else if (type === 'бюст') svgContent = svgIcons.бюст;
    else svgContent = svgIcons['не указан'];
    const color = getColorByCondition(condition);
    if (svgContent) {
        let coloredSvg = svgContent;
        coloredSvg = coloredSvg.replace(/fill="[^"]*"/g, `fill="${color}"`);
        coloredSvg = coloredSvg.replace(/stroke="[^"]*"/g, `stroke="${color}"`);
        coloredSvg = coloredSvg.replace(/fill=[^ >]+/g, `fill="${color}"`);
        coloredSvg = coloredSvg.replace(/stroke=[^ >]+/g, `stroke="${color}"`);
        const size = 50;
        coloredSvg = coloredSvg.replace(/<svg /i, `<svg width="${size}" height="${size}" `);
        return L.divIcon({
            html: coloredSvg,
            iconSize: [size, size],
            iconAnchor: [size/2, size],
            popupAnchor: [0, -size],
            className: 'custom-svg-marker'
        });
    } else {
        const fallbackSize = 18;
        return L.divIcon({
            html: `<div style="background-color: ${color}; width: ${fallbackSize}px; height: ${fallbackSize}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
            iconSize: [fallbackSize, fallbackSize],
            iconAnchor: [fallbackSize/2, fallbackSize/2],
            popupAnchor: [0, -fallbackSize/2],
            className: 'custom-marker'
        });
    }
}

// Обновление видимости стрелок галереи в зависимости от положения скролла.
// Объявлена на верхнем уровне, чтобы её могли вызывать и initLightbox,
// и обработчик popupopen в init().
function updateGalleryArrows(gallery) {
    const wrapper = gallery.closest('.photo-gallery-wrapper');
    if (!wrapper) return;
    const prev = wrapper.querySelector('.gallery-prev');
    const next = wrapper.querySelector('.gallery-next');
    const atStart = gallery.scrollLeft <= 2;
    const atEnd = gallery.scrollLeft + gallery.clientWidth >= gallery.scrollWidth - 2;
    if (prev) prev.classList.toggle('hidden', atStart);
    if (next) next.classList.toggle('hidden', atEnd);
}


// Инициализация карты
function initMap() {
	
    // Функция создания карты с заданной проекцией и слоем
    function createMap(crs, tileLayerOptions) {
        map = L.map('map', { crs: crs }).setView([55.7558, 37.6176], 11);
        
        // 1. Перемещаем зум-контрол в левый нижний угол
        if (map.zoomControl) {
            map.zoomControl.setPosition('bottomleft');
        }
        
        if (tileLayerOptions) {
            const tileLayer = L.tileLayer(tileLayerOptions.url, tileLayerOptions.options);
            tileLayer.addTo(map);
        }
        
        markersCluster = L.markerClusterGroup({
            chunkedLoading: true,
            maxClusterRadius: 35,
            disableClusteringAtZoom: 15
        });
        map.addLayer(markersCluster);
        
        // 2. Добавляем кастомную кнопку геолокации в правый нижний угол
        const locateControl = L.control({ position: 'bottomright' });
        locateControl.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'leaflet-bar locate-btn');
            div.innerHTML = '📍';
            div.title = 'Найти ближайшие памятники';
            div.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                locateUser();
            };
            return div;
        };
        locateControl.addTo(map);

        // Глобальные ссылки
        window.map = map;
        window.markersCluster = markersCluster;
    }

    // Функция создания OSM-карты (используется по умолчанию или при недоступности Яндекса)
    function createOsmMap() {
        createMap(L.CRS.EPSG3857, {
            // URL из письма CARTO со стилем Voyager и вашим ключом
            url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_3iyp_1_c1296302181e7d584ac0a479',
            options: {
                // Важно сохранить атрибуцию, это требование бесплатного тарифа
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
                maxZoom: 18, // В письме указан maxZoom 20
                minZoom: 9
            }
        });
        console.log('Используется CARTO Voyager с API-ключом');
    }

    // Карта всегда на OSM/CartoDB (Яндекс-ключ невалиден)
    createOsmMap();
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

// Парсер CSV
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
    console.log('processDataFromCSV вызвана, получено строк:', data.length);
    let validPoints = 0;
    let missingLat = 0, missingLon = 0, invalidCoord = 0;
    let skipped = [];
    allMonuments = [];
    for (let idx = 0; idx < data.length; idx++) {
        const row = data[idx];
        let latValue = row['lat'] ?? row['latitude'] ?? row['широта'] ?? null;
        let lonValue = row['lon'] ?? row['lng'] ?? row['longitude'] ?? row['долгота'] ?? null;
        const titleForLog = (row['title'] || row['name'] || row['название'] || 'Памятник Ленину').trim();
        if (latValue === undefined || latValue === '') {
            missingLat++;
            skipped.push({ id: idx, title: titleForLog, reason: 'нет широты' });
            continue;
        }
        if (lonValue === undefined || lonValue === '') {
            missingLon++;
            skipped.push({ id: idx, title: titleForLog, reason: 'нет долготы' });
            continue;
        }
        const lat = parseNumber(latValue);
        const lon = parseNumber(lonValue);
        if (isNaN(lat) || isNaN(lon)) {
            invalidCoord++;
            skipped.push({ id: idx, title: titleForLog, reason: 'нечисловые координаты', lat: latValue, lon: lonValue });
            continue;
        }
        if (lat < 55.4 || lat > 56.1 || lon < 37.1 || lon > 37.9) {
            if (Math.abs(lat - 55.75) > 1.2 || Math.abs(lon - 37.62) > 1.2) {
                skipped.push({ id: idx, title: titleForLog, reason: 'выход за границы Москвы', lat, lon });
                continue;
            }
        }
        let title = (row['title'] || row['name'] || row['название'] || 'Памятник Ленину').trim();
        const address = (row['address'] || row['адрес'] || '').trim();
        if (title === 'Памятник Ленину' && address) {
            title = `Памятник Ленину (${address.substring(0, 35)})`;
        }
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
        let monumentType = (row['type'] || row['тип'] || 'не указан').trim().toLowerCase();
        if (monumentType !== 'фигура' && monumentType !== 'бюст') monumentType = 'не указан';
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
        const typeInfo = (row['type'] || row['тип'] || '').trim();
        allMonuments.push({
            id: idx, lat, lon, title, address, condition,
            sculptor, year, description, material, heritage, typeInfo,
            monumentType, photoUrls
        });
        validPoints++;
    }
	window.allMonuments = allMonuments;   // <-- ДОБАВИТЬ ЭТУ СТРОКУ
    console.log('✅ Загружено точек:', validPoints);
    console.log('⚠️ Пропущено всего:', data.length - validPoints);
    console.log('📋 Детали пропущенных:', skipped);
    document.getElementById('totalCount').innerText = validPoints;
    if (validPoints === 0) {
        alert('⚠️ Не найдено точек с координатами. Проверьте консоль для деталей.');
        return;
    }
    populateFilterOptions();   // заполняем выпадающие списки
    updateMapAndList();        // обновляем карту и список
	// Если был отложенный запрос на памятник – выполняем
	console.log('📌 processDataFromCSV: pendingMonumentId =', pendingMonumentId);
	if (pendingMonumentId !== null) {
		console.log('🔁 Выполняем отложенный запрос на памятник', pendingMonumentId);
		highlightMonument(pendingMonumentId);
		pendingMonumentId = null;
	}
	if (window._checkPendingQuiz) {
		console.log('📌 Вызов _checkPendingQuiz');
		window._checkPendingQuiz();
	}
}

function populateFilterOptions() {
    const materials = new Set();
    const sculptors = new Set();

    allMonuments.forEach(mon => {
        if (mon.material && mon.material.trim()) materials.add(mon.material);
        if (mon.sculptor && mon.sculptor.trim()) {
            // Разделяем по запятым, точкам с запятой, пробелам
            const names = mon.sculptor.split(/[,;\s]+/).filter(name => name.trim().length > 0);
            names.forEach(name => sculptors.add(name));
        }
    });

    const materialSelect = document.getElementById('filter-material');
    if (materialSelect) {
        materialSelect.innerHTML = '<option value="all">Материал: все</option>';
        Array.from(materials).sort().forEach(m => {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = m;
            materialSelect.appendChild(option);
        });
    }

    const sculptorSelect = document.getElementById('filter-sculptor');
    if (sculptorSelect) {
        sculptorSelect.innerHTML = '<option value="all">Скульптор: все</option>';
        Array.from(sculptors).sort().forEach(s => {
            const option = document.createElement('option');
            option.value = s;
            option.textContent = s;
            sculptorSelect.appendChild(option);
        });
    }
}

function getFilteredMonuments() {
    let result = allMonuments;
    // фильтр по статусу
    if (currentFilter !== 'all') {
        result = result.filter(m => m.condition === currentFilter);
    }
    // фильтр по типу
    if (filterType !== 'all') {
        result = result.filter(m => m.monumentType === filterType);
    }
    // фильтр по материалу
    if (filterMaterial !== 'all') {
        result = result.filter(m => m.material === filterMaterial);
    }
    // фильтр по скульптору
	if (filterSculptor !== 'all') {
		result = result.filter(m => {
			if (!m.sculptor) return false;
			const names = m.sculptor.split(/[,;\s]+/).filter(n => n.trim().length > 0);
			return names.includes(filterSculptor);
		});
	}
    // фильтр по фото
    if (filterPhoto === 'yes') {
        result = result.filter(m => m.photoUrls && m.photoUrls.length > 0);
    } else if (filterPhoto === 'no') {
        result = result.filter(m => !m.photoUrls || m.photoUrls.length === 0);
    }
    // поиск
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        result = result.filter(m => 
            [m.title, m.address, m.sculptor, m.year, m.description]
                .join(' ')
                .toLowerCase()
                .includes(q)
        );
    }
    return result;
}

function updateMapAndList() {
    const filtered = getFilteredMonuments();
    displayMonuments(filtered);
    if (sidebarVisible) {
        renderList();
    } else {
        const totalAll = allMonuments.length;
        const filteredCount = filtered.length;
        const headerElement = document.querySelector('.sidebar-header h3');
        if (headerElement) {
            headerElement.textContent = `Список памятников (${filteredCount}/${totalAll})`;
        }
    }
    
    // Обновляем попап геолокации, если он есть — чтобы список ближайших
    // всегда соответствовал текущим фильтрам
    renderNearestPopup();
}

async function loadPhotoAttribution() {
    const attributionCsvUrl = 'data/images/photo_attribution.csv';
    try {
        const response = await fetch(attributionCsvUrl);
        if (!response.ok) return;
        const csvText = await response.text();
        const data = parseCSV(csvText);
        for (const row of data) {
            const fileName = row['name']?.trim();
            if (fileName) {
                photoAttribution[fileName] = {
                    author: row['author']?.trim() || '',
                    source: row['source']?.trim() || '',
                    title: row['title']?.trim() || ''
                };
            }
        }
        console.log('✅ Загружена атрибуция для', Object.keys(photoAttribution).length, 'фото');
    } catch (err) {
        console.warn('Не удалось загрузить photo_attribution.csv:', err);
    }
}

// Отображение маркеров
function originalDisplayMonuments(monuments) {
    markersCluster.clearLayers();
    markerMap.clear();
    //const isMobile = window.matchMedia('(max-width: 600px)').matches;
    for (const mon of monuments) {
        const popupHtml = generatePopupHtml(mon);
        const icon = getMarkerIcon(mon.monumentType, mon.condition);
        const marker = L.marker([mon.lat, mon.lon], { icon: icon });
        // На десктопе — стандартный popup с контентом
        // На мобильных — popup не нужен, контент через _mobileShowInfo в click handler
        marker.bindPopup(popupHtml, {
			maxWidth: 400,
			className: 'monument-popup-wrapper',
			autoPan: true,
			autoPanPadding: [20, 100]  // 100px снизу — чтобы не заезжал под футер
		});
        markersCluster.addLayer(marker);
        markerMap.set(mon.id, marker);
        
        // Обработчик клика по маркеру
        marker.on('click', function(e) {
            if (window.router) {
                window.router.goToMonument(mon.id);
            } else {
                highlightMonument(mon.id);
            }
        });
    }
    updateFilterCounter();
}

// displayMonuments — публичное имя для оригинальной функции
displayMonuments = originalDisplayMonuments;

// Генерация попапа
function generatePopupHtml(mon) {
    let conditionIcon = mon.condition === 'существует' ? '🔴' : (mon.condition === 'утрачен' ? '🔘' : '🔴');
    let html = `<div class="popup-container">`;
    html += `<strong>${escapeHtml(mon.title)}</strong><br>`;
    if (mon.address) html += `📍 ${escapeHtml(mon.address)}<br>`;
    html += `🏷 Состояние: ${conditionIcon} ${escapeHtml(mon.condition)}<br>`;
    if (mon.sculptor) html += `🎨 Скульптор: ${escapeHtml(mon.sculptor)}<br>`;
    if (mon.year) html += `📅 Год: ${escapeHtml(mon.year)}<br>`;
    if (mon.material) html += `🧱 Материал: ${escapeHtml(mon.material)}<br>`;
    if (mon.heritage) html += `🏛 Охрана: ${escapeHtml(mon.heritage)}<br>`;
    if (mon.typeInfo) html += `🏷 Тип: ${escapeHtml(mon.typeInfo)}<br>`;
    if (mon.description) {
        const fullDesc = escapeHtml(mon.description);
        if (fullDesc.length > 120) {
            const shortDesc = fullDesc.substring(0, 120);
            const safeFullDesc = fullDesc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            html += `<div class="desc-container" data-full="${safeFullDesc}">📖 ${shortDesc}... <a href="#" class="expand-desc">Подробнее</a></div>`;
        } else {
            html += `<div>📖 ${fullDesc}</div>`;
        }
    }
    html += `<i class="coords-link" data-lat="${mon.lat}" data-lon="${mon.lon}" style="cursor:pointer;color:#c12b2b;text-decoration:underline;">Координаты: ${mon.lat.toFixed(5)}, ${mon.lon.toFixed(5)}</i><br>`;
    
	if (mon.photoUrls && mon.photoUrls.length > 0) {
		const needsNav = mon.photoUrls.length > 3;
		html += `<div class="photo-gallery-wrapper">`;
		if (needsNav) {
			html += `<button class="gallery-nav gallery-prev" aria-label="Назад">‹</button>`;
		}
		html += `<div class="photo-gallery">`;
		for (let i = 0; i < mon.photoUrls.length; i++) {
			const imgPath = mon.photoUrls[i];
			html += `<img src="${imgPath}" alt="Фото памятника" class="gallery-thumb" data-full="${imgPath}" loading="lazy">`;
		}
		html += `</div>`;
		if (needsNav) {
			html += `<button class="gallery-nav gallery-next" aria-label="Вперёд">›</button>`;
		}
		html += `</div>`;
	}
	
    html += `</div>`;
    return html;
}

// Загрузка данных
async function loadData() {
    console.log('loadData: начало загрузки CSV');
    const overlay = document.getElementById('loading-overlay');
    try {
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

function applyFilter(filterValue) {
    currentFilter = filterValue;
    updateMapAndList(); // эта функция вызовет displayMonuments с отфильтрованным массивом
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
    if (existsBtn) existsBtn.innerHTML = `🔴 Существует (${existsCount})`;
    if (lostBtn) lostBtn.innerHTML = `🔘 Утрачен (${lostCount})`;
}

function bindFilterButtons() {
    document.querySelector('.filter-btn[data-filter="all"]')?.addEventListener('click', () => applyFilter('all'));
    document.querySelector('.filter-btn[data-filter="существует"]')?.addEventListener('click', () => applyFilter('существует'));
    document.querySelector('.filter-btn[data-filter="утрачен"]')?.addEventListener('click', () => applyFilter('утрачен'));
    document.querySelector('.filter-btn[data-filter="reset"]')?.addEventListener('click', () => resetAllFilters());
}

function resetAllFilters() {
    // Сброс переменных
    currentFilter = 'all';
    filterType = 'all';
    filterMaterial = 'all';
    filterSculptor = 'all';
    filterPhoto = 'all';
    searchQuery = '';

    // Сброс UI кнопок статуса
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === 'all') btn.classList.add('active');
        else btn.classList.remove('active');
    });

    // Сброс выпадающих списков
    const typeSelect = document.getElementById('filter-type');
    if (typeSelect) typeSelect.value = 'all';
    const materialSelect = document.getElementById('filter-material');
    if (materialSelect) materialSelect.value = 'all';
    const sculptorSelect = document.getElementById('filter-sculptor');
    if (sculptorSelect) sculptorSelect.value = 'all';
    const photoSelect = document.getElementById('filter-photo');
    if (photoSelect) photoSelect.value = 'all';

    // Очистка поля поиска
    const searchInput = document.getElementById('list-search-input');
    if (searchInput) searchInput.value = '';

    updateMapAndList();
}

// Модальное окно
function initLightbox() {
    const modal = document.createElement('div');
    modal.id = 'lightbox-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="lightbox-content">
            <span class="lightbox-close">&times;</span>
            <button class="lightbox-prev">&#10094;</button>
            <button class="lightbox-next">&#10095;</button>
            <img class="lightbox-img" src="" alt="Полноразмерное изображение">
            <div class="lightbox-attribution"></div>
        </div>
    `;
    document.body.appendChild(modal);
    const modalImg = modal.querySelector('.lightbox-img');
    const modalAttr = modal.querySelector('.lightbox-attribution');
    const closeBtn = modal.querySelector('.lightbox-close');
    const prevBtn = modal.querySelector('.lightbox-prev');
    const nextBtn = modal.querySelector('.lightbox-next');
    let currentImages = [];
    let currentIndex = 0;
    function updateLightbox(index) {
        if (currentImages.length === 0) return;
        if (index < 0) index = currentImages.length - 1;
        if (index >= currentImages.length) index = 0;
        currentIndex = index;
        const fullPath = currentImages[currentIndex];
        modalImg.src = fullPath;
        const parts = fullPath.split('/');
        const fileName = parts[parts.length - 1];
        const attr = photoAttribution[fileName];
        if (attr && (attr.author || attr.source)) {
            let attrHtml = '<div class="attribution-text">';
            if (attr.author) attrHtml += `<span>Автор: ${escapeHtml(attr.author)}</span>`;
            if (attr.source) {
                if (attr.source.startsWith('http')) {
                    attrHtml += `<span>Источник: <a href="${escapeHtml(attr.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attr.source)}</a></span>`;
                } else {
                    attrHtml += `<span>Источник: ${escapeHtml(attr.source)}</span>`;
                }
            }
            attrHtml += `</div>`;
            modalAttr.innerHTML = attrHtml;
            modalAttr.style.display = 'block';
        } else {
            modalAttr.style.display = 'none';
        }
    }
    document.addEventListener('click', (e) => {
        const thumb = e.target.closest('.gallery-thumb');
        if (thumb && thumb.dataset.full) {
            e.preventDefault();
            const popupContainer = thumb.closest('.popup-container');
            if (popupContainer) {
                const thumbs = popupContainer.querySelectorAll('.gallery-thumb');
                currentImages = Array.from(thumbs).map(t => t.dataset.full);
                currentIndex = currentImages.indexOf(thumb.dataset.full);
                if (currentIndex === -1) currentIndex = 0;
                updateLightbox(currentIndex);
                modal.style.display = 'flex';
            }
        }
    });
	// Делегирование клика по ссылкам в попапе геолокации.
    // Работает через capture, чтобы поймать клик раньше, чем Leaflet
    // обработает его как клик по карте.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('.nearest-link');
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        const id = link.dataset.monumentId;
        if (window.userMarker) window.userMarker.closePopup();
        if (window.router) {
            window.router.goToMonument(id);
        } else {
            highlightMonument(id);
        }
    }, true);
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentImages.length) updateLightbox(currentIndex - 1);
    });
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentImages.length) updateLightbox(currentIndex + 1);
    });
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        modalImg.src = '';
        modalAttr.innerHTML = '';
        currentImages = [];
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modalImg.src = '';
            modalAttr.innerHTML = '';
            currentImages = [];
        }
    });
    document.addEventListener('keydown', (e) => {
        if (modal.style.display === 'flex') {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                prevBtn.click();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                nextBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeBtn.click();
            }
        }
    }, true);
    document.addEventListener('click', (e) => {
		const expandLink = e.target.closest('.expand-desc');
		if (expandLink) {
			e.preventDefault();
			const container = expandLink.closest('.desc-container');
			if (container && !container.classList.contains('expanded')) {
				const fullText = container.getAttribute('data-full');
				if (fullText) {
					// Очищаем контейнер
					container.innerHTML = '';
					// Создаём div для полного текста
					const fullDiv = document.createElement('div');
					fullDiv.className = 'desc-full';
					fullDiv.textContent = fullText; // экранирование уже сделано
					container.appendChild(fullDiv);
					// Добавляем класс, который ограничит высоту
					container.classList.add('expanded');
				}
			}
		}
	});
	
	// ==================== ГАЛЕРЕЯ: СТРЕЛКИ И КРАЯ ====================

	// Клик по стрелкам галереи
	document.addEventListener('click', (e) => {
		const navBtn = e.target.closest('.gallery-nav');
		if (!navBtn) return;
		e.preventDefault();
		e.stopPropagation();

		const wrapper = navBtn.closest('.photo-gallery-wrapper');
		if (!wrapper) return;
		const gallery = wrapper.querySelector('.photo-gallery');
		if (!gallery) return;

		// Скроллим на ширину видимой области (одна «страница» = 3 фото)
		const scrollAmount = gallery.clientWidth;
		if (navBtn.classList.contains('gallery-prev')) {
			gallery.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
		} else {
			gallery.scrollBy({ left: scrollAmount, behavior: 'smooth' });
		}
	}, true); // capture — чтобы срабатывало раньше других кликов

	document.addEventListener('scroll', (e) => {
		const g = e.target;
		if (g.classList && g.classList.contains('photo-gallery')) {
			updateGalleryArrows(g);
		}
	}, true); // capture — событие scroll не всплывает
}

// === Функции для боковой панели ===
function renderList() {
    const container = document.getElementById('list-container');
    if (!container) return;
    container.innerHTML = '';
    const filtered = getFilteredMonuments();   // ← единая фильтрация
	
    // 🔽 ОБНОВЛЯЕМ ЗАГОЛОВОК
    const totalAll = allMonuments.length;
    const filteredCount = filtered.length;
    const headerElement = document.querySelector('.sidebar-header h3');
    if (headerElement) {
        headerElement.textContent = `Список памятников (${filteredCount}/${totalAll})`;
    }

    if (!filtered.length) {
        container.innerHTML =
            '<div class="loading-placeholder">Нет данных</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
	
    filtered.forEach(mon => {
		try {
			console.log('Создаю карточку:', mon.title);
			const card = document.createElement('div');
			card.className = 'list-card';

			card.dataset.id = mon.id;
			card.dataset.lat = mon.lat;
			card.dataset.lon = mon.lon;

			const photo = document.createElement('div');
			photo.className = 'list-card-photo';

			if (mon.photoUrls?.length) {

				const img = document.createElement('img');

				img.src = mon.photoUrls[0];
				img.loading = 'lazy';

				img.onerror = () => {
					photo.innerHTML =
						'<div class="placeholder-photo">📷</div>';
				};

				photo.appendChild(img);

			} else {

				photo.innerHTML =
					'<div class="placeholder-photo">📷</div>';
			}

			const info = document.createElement('div');
			info.className = 'list-card-info';

			const photoCount = mon.photoUrls?.length || 0;

			info.innerHTML = `
				<div class="list-card-title">
					${escapeHtml(mon.title)}
				</div>

				<div class="list-card-address">
					📍 ${escapeHtml(mon.address || 'Адрес не указан')}
				</div>

				<div class="list-card-meta">
					${mon.year ? `🗓 ${escapeHtml(mon.year)}` : ''}
					${photoCount ? `📷 ${photoCount}` : ''}
				</div>

				<div class="list-card-status ${getStatusClass(mon.condition)}">
					${escapeHtml(mon.condition)}
				</div>
			`;

			card.appendChild(photo);
			card.appendChild(info);

			card.addEventListener('click', () => {
				// Меняем хеш вместо прямого вызова
				if (window.router) {
					window.router.goToMonument(mon.id);
				} else {
					// Fallback
					highlightMonument(mon.id);
				}
			});
				

			fragment.appendChild(card);
		} catch(err) {

			console.error(
				'Ошибка карточки',
				mon,
				err
			);
		}
		
    });
 
    container.appendChild(fragment);
	console.log(
		'Карточек в контейнере:',
		container.children.length
	);

	console.log(
		container.firstElementChild?.outerHTML
	);
}

function toggleSidebar(show) {
    const sidebar = document.getElementById('list-sidebar');
    if (!sidebar) return;
    if (show === undefined) {
        sidebar.classList.toggle('hidden');
        sidebarVisible = !sidebar.classList.contains('hidden');
    } else {
        if (show) sidebar.classList.remove('hidden');
        else sidebar.classList.add('hidden');
        sidebarVisible = show;
    }
    if (sidebarVisible) {
        updateMapAndList();
    }
}

function getStatusClass(condition) {
    if (condition === 'существует') return 'exists';
    if (condition === 'утрачен') return 'lost';
    return 'unknown';
}

// === Инициализация (в конце) ===
async function init() {
    console.log('init: начало инициализации');
    initMap();
	// Инициализация стрелок галереи при открытии попапа
    map.on('popupopen', (e) => {
        const popupEl = e.popup.getElement();
        if (!popupEl) return;
        // Небольшая задержка, чтобы браузер отрисовал flex-раскладку
        setTimeout(() => {
            popupEl.querySelectorAll('.photo-gallery').forEach(g => updateGalleryArrows(g));
        }, 60);
    });
    bindFilterButtons();
    initLightbox();
    await Promise.all([loadSvgIcons(), loadPhotoAttribution()]);
    console.log('init: иконки и атрибуция загружены');
    if (typeof window.loadDataCustom === 'function') {
        window.loadDataCustom();
    } else {
        await loadData();
    }
	
    window.addEventListener('resize', () => map?.invalidateSize());

    // Обработчики для боковой панели
    const toggleBtn = document.getElementById('toggle-list-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => toggleSidebar(true));
    }
    const toggleBtnCollapsed = document.getElementById('toggle-list-btn-collapsed');
    if (toggleBtnCollapsed) {
        toggleBtnCollapsed.addEventListener('click', () => toggleSidebar(true));
    }
    const closeBtn = document.getElementById('close-sidebar-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => toggleSidebar(false));
    }
    const searchInput = document.getElementById('list-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            updateMapAndList();
        });
    }
	
	// Обработчики дополнительных фильтров
	const typeSelect = document.getElementById('filter-type');
	if (typeSelect) {
		typeSelect.addEventListener('change', (e) => {
			filterType = e.target.value;
			updateMapAndList();
		});
	}
	const materialSelect = document.getElementById('filter-material');
	if (materialSelect) {
		materialSelect.addEventListener('change', (e) => {
			filterMaterial = e.target.value;
			updateMapAndList();
		});
	}
	const sculptorSelect = document.getElementById('filter-sculptor');
	if (sculptorSelect) {
		sculptorSelect.addEventListener('change', (e) => {
			filterSculptor = e.target.value;
			updateMapAndList();
		});
	}
	const photoSelect = document.getElementById('filter-photo');
	if (photoSelect) {
		photoSelect.addEventListener('change', (e) => {
			filterPhoto = e.target.value;
			updateMapAndList();
		});
	}
	// Кнопка сворачивания/разворачивания
	const collapseBtn = document.getElementById('collapse-toggle-btn');
	if (collapseBtn) {
		collapseBtn.textContent = '';
		collapseBtn.addEventListener('click', () => {
			document.body.classList.toggle('collapsed');
		});
		

	}

    // Обработчик клика по координатам в попапе
    document.addEventListener('click', function(e) {
        const coordsLink = e.target.closest('.coords-link');
        if (coordsLink) {
            const lat = parseFloat(coordsLink.dataset.lat);
            const lon = parseFloat(coordsLink.dataset.lon);
            if (map && !isNaN(lat) && !isNaN(lon)) {
                const isMobile = window.matchMedia('(max-width: 600px)').matches;
                if (isMobile) {
                    // Мобильный: маркер на 15% от нижнего края экрана
                    const mapHeight = map.getSize().y;
                    const shiftUp = mapHeight * 0.35;
                    const topLeft = map.containerPointToLatLng([0, 0]);
                    const bottomLeft = map.containerPointToLatLng([0, mapHeight]);
                    const latPerPixel = (topLeft.lat - bottomLeft.lat) / mapHeight;
                    const newCenterLat = lat + shiftUp * latPerPixel;
                    map.setView([newCenterLat, lon], map.getZoom(), { animate: true });
                } else {
                    // Десктоп: центрировать маркер в центре карты
                    map.setView([lat, lon], map.getZoom(), { animate: true });
                }
            }
        }
    });
console.log('init: завершено');
}

window.parseCSV = parseCSV;
window.processDataFromCSV = processDataFromCSV;

// Делаем markerMap доступным глобально (для роутера)
window.markerMap = markerMap;  // или экспортируем через функцию

// Функция подсветки памятника по id
function highlightMonument(id) {
    console.log('🔥 highlightMonument вызван с id:', id, 'allMonuments.length =', allMonuments.length);
    if (!allMonuments || allMonuments.length === 0) {
        console.warn('Данные ещё не загружены, сохраняем запрос', id);
        pendingMonumentId = id;
        return;
    }
    const monId = typeof id === 'string' ? parseInt(id, 10) : id;
    const monument = allMonuments.find(m => m.id === monId);
    if (!monument) {
        console.warn(`Памятник с id ${monId} не найден`);
        alert('Памятник не найден');
        if (window.router) window.router.goHome();
        return;
    }

    const marker = markerMap.get(monId);
    if (marker) {
        if (marker.isPopupOpen()) {
            // Попап уже открыт (только что кликнули по маркеру) —
            // не трогаем карту, чтобы не было конфликта с autoPan
            markersCluster.refreshClusters();
        } else {
            // Закрываем любые другие открытые попапы (например, попап
            // геолокации), чтобы они не мешали показу нужного маркера
            map.closePopup();
            markersCluster.zoomToShowLayer(marker, () => {
                setTimeout(() => {
                    marker.openPopup();
                    markersCluster.refreshClusters();
                }, 200);
            });
        }
    } else {
        console.warn('Маркер не найден в markerMap');
        alert('Маркер не найден на карте, возможно, он скрыт фильтром');
    }

    // Подсветка карточки в списке (если панель открыта)
    const cards = document.querySelectorAll('.list-card');
    cards.forEach(card => {
        card.classList.remove('active');
        if (card.dataset.id && parseInt(card.dataset.id) === monId) {
            card.classList.add('active');
        }
    });
}

// Экспортируем в глобальный объект для роутера
window._highlightMonument = highlightMonument;

// Функция для сброса к главному виду (закрыть все попапы, сбросить выделения)
function showMainView() {
    console.log('🏠 showMainView');
    // НЕ сбрасываем pendingMonumentId, если он был установлен для памятника
    // pendingMonumentId = null;  // закомментируем, чтобы не терять запрос
    if (map) map.closePopup();
    document.querySelectorAll('.list-card').forEach(card => card.classList.remove('active'));
    if (window._closeQuiz) window._closeQuiz();
    if (sidebarVisible) toggleSidebar(false);
}

window._showMainView = showMainView;

// Обработчик клика по маркеру — встроен в originalDisplayMonuments

// === МОБИЛЬНАЯ ЛОГИКА ===
function initMobileUI() {
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (!isMobile) return;

    window._isMobile = true;

    // Исправляем viewport
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
        viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5, viewport-fit=cover');
    }

    // --- 1. Создаём бургер-кнопку и меню ---
    const burgerBtn = document.createElement('button');
    burgerBtn.className = 'burger-btn';
    burgerBtn.textContent = '☰';
    document.querySelector('.map-header').appendChild(burgerBtn);

    const burgerOverlay = document.createElement('div');
    burgerOverlay.className = 'burger-menu-overlay';
    document.body.appendChild(burgerOverlay);

    const burgerMenu = document.createElement('div');
    burgerMenu.className = 'burger-menu';
    burgerMenu.innerHTML = `
        <button class="burger-close">✕</button>
        <div class="burger-section">
            <div class="burger-section-title">Навигация</div>
            <button class="burger-btn-item" id="burger-list-btn">📋 Список</button>
            <button class="burger-btn-item" id="burger-quiz-btn">🎯 Пройти тест</button>
        </div>
        <div class="burger-section">
            <div class="burger-section-title">Статус</div>
            <button class="burger-btn-item" id="burger-filter-all">Все точки</button>
            <button class="burger-btn-item" id="burger-filter-exists">🔴 Существует</button>
            <button class="burger-btn-item" id="burger-filter-lost">🔘 Утрачен</button>
            <button class="burger-btn-item" id="burger-filter-reset">⟳ Сбросить</button>
        </div>
        <div class="burger-section">
            <div class="burger-section-title">Тип</div>
            <select class="burger-select" id="burger-filter-type">
                <option value="all">Все типы</option>
                <option value="фигура">Фигура</option>
                <option value="бюст">Бюст</option>
                <option value="не указан">Не указан</option>
            </select>
        </div>
        <div class="burger-section">
            <div class="burger-section-title">Материал</div>
            <select class="burger-select" id="burger-filter-material"><option value="all">Все материалы</option></select>
        </div>
        <div class="burger-section">
            <div class="burger-section-title">Скульптор</div>
            <select class="burger-select" id="burger-filter-sculptor"><option value="all">Все скульпторы</option></select>
        </div>
        <div class="burger-section">
            <div class="burger-section-title">Фото</div>
            <select class="burger-select" id="burger-filter-photo">
                <option value="all">Все</option>
                <option value="yes">Есть фото</option>
                <option value="no">Нет фото</option>
            </select>
        </div>
    `;
    document.body.appendChild(burgerMenu);

    // Открытие/закрытие бургера
    function openBurger() {
        burgerMenu.classList.add('open');
        burgerOverlay.classList.add('open');
    }
    function closeBurger() {
        burgerMenu.classList.remove('open');
        burgerOverlay.classList.remove('open');
    }
    burgerBtn.addEventListener('click', openBurger);
    burgerOverlay.addEventListener('click', closeBurger);
    burgerMenu.querySelector('.burger-close').addEventListener('click', closeBurger);

    // Кнопка списка
    document.getElementById('burger-list-btn').addEventListener('click', () => {
        closeBurger();
        toggleSidebar(true);
    });

    // Кнопка теста
    document.getElementById('burger-quiz-btn').addEventListener('click', () => {
        closeBurger();
        if (typeof window._openQuiz === 'function') window._openQuiz();
    });

    // Кнопки статуса
    document.getElementById('burger-filter-all').addEventListener('click', () => {
        closeBurger();
        applyFilter('all');
        updateBurgerActiveState();
    });
    document.getElementById('burger-filter-exists').addEventListener('click', () => {
        closeBurger();
        applyFilter('существует');
        updateBurgerActiveState();
    });
    document.getElementById('burger-filter-lost').addEventListener('click', () => {
        closeBurger();
        applyFilter('утрачен');
        updateBurgerActiveState();
    });
    document.getElementById('burger-filter-reset').addEventListener('click', () => {
        closeBurger();
        resetAllFilters();
        updateBurgerActiveState();
    });

    // Обновление активного состояния кнопок статуса
    function updateBurgerActiveState() {
        document.querySelectorAll('[id^="burger-filter-"]').forEach(btn => btn.classList.remove('active'));
        if (currentFilter === 'all') document.getElementById('burger-filter-all').classList.add('active');
        else if (currentFilter === 'существует') document.getElementById('burger-filter-exists').classList.add('active');
        else if (currentFilter === 'утрачен') document.getElementById('burger-filter-lost').classList.add('active');
    }
    setTimeout(updateBurgerActiveState, 500);

    // Фильтры в бургере
    const typeSelect = document.getElementById('burger-filter-type');
    const materialSelect = document.getElementById('burger-filter-material');
    const sculptorSelect = document.getElementById('burger-filter-sculptor');
    const photoSelect = document.getElementById('burger-filter-photo');

    // Синхронизируем селекты с основными
    function syncBurgerSelects() {
        if (typeSelect) typeSelect.value = filterType;
        if (materialSelect) materialSelect.value = filterMaterial;
        if (sculptorSelect) sculptorSelect.value = filterSculptor;
        if (photoSelect) photoSelect.value = filterPhoto;
    }
    setTimeout(syncBurgerSelects, 500);

    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            filterType = typeSelect.value;
            const mainSelect = document.getElementById('filter-type');
            if (mainSelect) mainSelect.value = filterType;
            updateMapAndList();
        });
    }
    if (materialSelect) {
        materialSelect.addEventListener('change', () => {
            filterMaterial = materialSelect.value;
            const mainSelect = document.getElementById('filter-material');
            if (mainSelect) mainSelect.value = filterMaterial;
            updateMapAndList();
        });
    }
    if (sculptorSelect) {
        sculptorSelect.addEventListener('change', () => {
            filterSculptor = sculptorSelect.value;
            const mainSelect = document.getElementById('filter-sculptor');
            if (mainSelect) mainSelect.value = filterSculptor;
            updateMapAndList();
        });
    }
    if (photoSelect) {
        photoSelect.addEventListener('change', () => {
            filterPhoto = photoSelect.value;
            const mainSelect = document.getElementById('filter-photo');
            if (mainSelect) mainSelect.value = filterPhoto;
            updateMapAndList();
        });
    }

    // Заполняем материалы и скульпторы после загрузки данных
    const fillBurgerFilters = () => {
        if (typeof allMonuments !== 'undefined' && allMonuments.length > 0) {
            const materials = new Set();
            const sculptors = new Set();
            allMonuments.forEach(mon => {
                if (mon.material && mon.material.trim()) materials.add(mon.material);
                if (mon.sculptor && mon.sculptor.trim()) {
                    mon.sculptor.split(/[,;\s]+/).forEach(n => { if (n.trim()) sculptors.add(n.trim()); });
                }
            });
            if (materialSelect) {
                materialSelect.innerHTML = '<option value="all">Все материалы</option>';
                Array.from(materials).sort().forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    materialSelect.appendChild(opt);
                });
            }
            if (sculptorSelect) {
                sculptorSelect.innerHTML = '<option value="all">Все скульпторы</option>';
                Array.from(sculptors).sort().forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s;
                    opt.textContent = s;
                    sculptorSelect.appendChild(opt);
                });
            }
        }
    };
    setTimeout(fillBurgerFilters, 600);

    // --- 2. Bottom sheet: свайп вниз для закрытия ---
    const sidebar = document.getElementById('list-sidebar');
    if (sidebar) {
        let startY = 0, currentY = 0, isDragging = false;

        sidebar.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
            sidebar.style.transition = 'none';
        }, { passive: true });

        sidebar.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;
            if (diff > 0) sidebar.style.transform = `translateY(${diff}px)`;
        }, { passive: true });

        sidebar.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            sidebar.style.transition = 'transform 0.3s ease';
            const diff = currentY - startY;
            if (diff > 100) {
                sidebar.classList.add('hidden');
                sidebar.style.transform = '';
                sidebarVisible = false;
            } else {
                sidebar.style.transform = '';
            }
            startY = 0; currentY = 0;
        });
    }

    // --- 3. Автопрокрутка к карточке ---
    const originalHighlight = window._highlightMonument;
    if (originalHighlight) {
        window._highlightMonument = function(id) {
            originalHighlight(id);
            setTimeout(() => {
                const card = document.querySelector(`.list-card[data-id="${id}"]`);
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        };
    }
}

// Запуск мобильной логики после инициализации
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initMobileUI, 100);
});

// === ГЕОЛОКАЦИЯ И ПОИСК БЛИЖАЙШИХ ПАМЯТНИКОВ ===

function locateUser() {
    const btn = document.querySelector('.locate-btn');
    if (!navigator.geolocation) {
        alert('Геолокация не поддерживается вашим браузером');
        return;
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳';

    navigator.geolocation.getCurrentPosition(
        (position) => {
            btn.innerHTML = originalText;
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;

            if (window.userMarker) {
                map.removeLayer(window.userMarker);
            }

            const userIcon = L.divIcon({
                className: 'user-location-marker',
                html: '<div style="background: #007bff; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });

            window.userMarker = L.marker([userLat, userLon], { icon: userIcon }).addTo(map);

            
            // Запоминаем координаты пользователя, чтобы потом можно было
            // пересобирать попап при смене фильтров
            window.userLat = userLat;
            window.userLon = userLon;

            // Первичный рендер попапа (внутри использует findNearestMonuments,
            // который уже работает по отфильтрованному списку)
            window.userMarker.bindPopup('', { 
                maxWidth: 500, 
                className: 'nearest-popup-wrapper'
            });
            renderNearestPopup();
            window.userMarker.openPopup();

            map.setView([userLat, userLon], 14);
			
        },
        (error) => {
            btn.innerHTML = originalText;
            console.error('Ошибка геолокации:', error);
            alert('Не удалось определить местоположение. Убедитесь, что разрешен доступ к геолокации в браузере.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

// Обновление содержимого попапа геолокации (используется и при создании,
// и при смене фильтров, чтобы список ближайших всегда соответствовал выборке)
function renderNearestPopup() {
    if (!window.userMarker || !window.userLat || !window.userLon) return;
    
    const nearest = findNearestMonuments(window.userLat, window.userLon, 3);
    
    let popupHtml = `<div class="nearest-popup"><strong>Ближайшие памятники:</strong><ul>`;
    if (nearest.length === 0) {
        popupHtml += `<li>Нет памятников, подходящих под фильтры</li>`;
    } else {
        nearest.forEach(mon => {
            const distText = mon.distance < 1000 
                ? `${Math.round(mon.distance)} м` 
                : `${(mon.distance / 1000).toFixed(1)} км`;
            popupHtml += `<li><a href="#/monument/${mon.id}" data-monument-id="${mon.id}" class="nearest-link">${escapeHtml(mon.title)}</a> — ${distText}</li>`;
        });
    }
    popupHtml += `</ul></div>`;
    
    // Если попап открыт — обновляем содержимое; если закрыт — просто меняем html
    const wasOpen = window.userMarker.isPopupOpen();
    window.userMarker.setPopupContent(popupHtml);
    if (wasOpen) {
        // setPopupContent не переоткрывает попап — заставляем Leaflet
        // перерисовать его, закрыв и открыв заново
        window.userMarker.closePopup();
        window.userMarker.openPopup();
    }
}

// Формула гаверсинуса для расчета расстояния между координатами
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Радиус Земли в метрах
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Поиск ближайших памятников (только среди видимых на карте сейчас)
function findNearestMonuments(userLat, userLon, count = 3) {
    // Берём не все памятники, а лишь те, что проходят текущие фильтры
    const visible = getFilteredMonuments();
    if (!visible || visible.length === 0) return [];
    
    const monumentsWithDist = visible.map(mon => {
        const dist = getDistanceFromLatLonInMeters(userLat, userLon, mon.lat, mon.lon);
        return { ...mon, distance: dist };
    });
    
    monumentsWithDist.sort((a, b) => a.distance - b.distance);
    return monumentsWithDist.slice(0, count);
}

// Запуск
init();