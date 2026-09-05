// ==================== НАСТРОЙКИ ====================
const CSV_URL = (typeof window !== 'undefined' && window.DEF_CSV_URL) || 'data/lenin_monuments_coords.csv';

let yk1 = 'ZDg1M2ZhNTAtNTYwNC00N2I';
let yk2 = '2LThhNjktZTIzMWI5YmI3MjRi000';

const YANDEX_KEY = yk1+yk2 ? atob(yk1+yk2) : null;
if (!YANDEX_KEY) console.warn('Ключ Яндекс Tiles не найден!');

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

// Инициализация карты
function initMap() {
	
    // Функция создания карты с заданной проекцией и слоем
    function createMap(crs, tileLayerOptions) {
        map = L.map('map', { crs: crs }).setView([55.7558, 37.6176], 11);
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
        // Глобальные ссылки (уже есть)
        window.map = map;
        window.markersCluster = markersCluster;
    }

    // Функция создания OSM-карты (используется по умолчанию или при недоступности Яндекса)
    function createOsmMap() {
        createMap(L.CRS.EPSG3857, {
            url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
            options: {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
                subdomains: 'abcd',
                maxZoom: 18,
                minZoom: 9
            }
        });
        console.log('Используется OSM');
    }

    // Проверка Яндекс.Карт
    function checkYandexAvailability() {
        if (!YANDEX_KEY) {
            createOsmMap();
            return;
        }
        // Создаём тестовый запрос к одному тайлу (центр Москвы, зум 10)
        const testUrl = `https://tiles.api-maps.yandex.ru/v1/tiles/?x=500&y=350&z=10&lang=ru_RU&l=map&apikey=${YANDEX_KEY}`;
        console.log('Проверка доступности Яндекс.Карт...');
        fetch(testUrl, { method: 'HEAD' })
            .then(response => {
                if (response.ok) {
                    console.log('Яндекс.Карты доступны, создаём карту с Яндекс-слоем');
                    // Создаём карту с проекцией EPSG:3395 и Яндекс-слоем
                    createMap(L.CRS.EPSG3395, {
                        url: `https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&lang=ru_RU&l=map&apikey=${YANDEX_KEY}`,
                        options: {
                            attribution: '&copy; <a href="https://yandex.ru/legal/maps_termsofuse" target="_blank" style="vertical-align:bottom;">Условия использования</a> &nbsp; <a href="https://yandex.ru/maps" target="_blank"><img src="//maps.yastatic.net/s3/front-maps-static/maps-front-maps/static/v57/icons/core/logo-web-ru-80x40.svg" alt="Яндекс.Карты" style="height:40px; vertical-align:bottom;"></a>',
                            maxZoom: 19,
                            minZoom: 9,
                        }
                    });
                    // Показываем логотип Яндекса
                    
                } else {
                    console.warn('Яндекс.Карты вернули ошибку, используем OSM');
                    createOsmMap();
					// Скрыть логотип Яндекса (если есть)
					
                }
            })
            .catch(err => {
                console.warn('Ошибка при проверке Яндекс.Карт:', err);
                createOsmMap();
				// Скрыть логотип Яндекса (если есть)
				
            });
    }

    // Запускаем проверку
    checkYandexAvailability();
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
    populateFilterOptions();   // заполняем выпадающие списки (добавить эту строку)
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
    displayMonuments(filtered);   // обновляем карту
    if (sidebarVisible) {
        renderList();             // если панель открыта – обновляем список
    } else {
        // даже если панель закрыта, обновим заголовок в DOM, чтобы при открытии он был актуальным
        const totalAll = allMonuments.length;
        const filteredCount = filtered.length;
        const headerElement = document.querySelector('.sidebar-header h3');
        if (headerElement) {
            headerElement.textContent = `Список памятников (${filteredCount}/${totalAll})`;
        }
    }
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
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    for (const mon of monuments) {
        const popupHtml = generatePopupHtml(mon);
        const icon = getMarkerIcon(mon.monumentType, mon.condition);
        const marker = L.marker([mon.lat, mon.lon], { icon: icon });
        // На мобильных отключаем autoPan, чтобы карта не дёргалась при открытии popup
        if (isMobile) {
            marker.bindPopup(popupHtml, { autoPan: false });
        } else {
            marker.bindPopup(popupHtml);
        }
        markersCluster.addLayer(marker);
        markerMap.set(mon.id, marker);
    }
    updateFilterCounter();
}

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
		collapseBtn.addEventListener('click', () => {
			document.body.classList.toggle('collapsed');
			collapseBtn.textContent = document.body.classList.contains('collapsed') ? '▼ Развернуть' : '▲ Свернуть';
		});
	}
	
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
        const isMobile = window.matchMedia('(max-width: 600px)').matches;
        
        if (isMobile) {
            // На мобильных: кастомная панель + перемещение карты
            if (window._mobileShowInfo) {
                window._mobileShowInfo(monument);
            }
            markersCluster.refreshClusters();
        } else {
            // Десктоп: стандартное поведение
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

// Дополнительно: функция для обработки клика по маркеру (будет использоваться в displayMonuments)
// Для этого модифицируем создание маркеров в displayMonuments
// Вместо прямой привязки popup, добавляем обработчик click, который меняет хеш
// Но поскольку у нас уже есть привязка через bindPopup, нужно аккуратно совместить

// Переопределяем displayMonuments, чтобы добавить обработчик клика
// Сохраним оригинальную функцию и заменим её обёрткой

displayMonuments = function(monuments) {
    originalDisplayMonuments(monuments);
    for (const mon of monuments) {
        const marker = markerMap.get(mon.id);
        if (marker) {
            marker.off('click');
            marker.on('click', function(e) {
                if (window.router) {
                    window.router.goToMonument(mon.id);
                } else {
                    highlightMonument(mon.id);
                }
            });
        }
    }
};

// === МОБИЛЬНАЯ ЛОГИКА ===
function initMobileUI() {
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    if (!isMobile) return;

    window._isMobile = true;

    // Перемещаем зум-контрол в правый нижний угол
    if (map && map.zoomControl) {
        map.zoomControl.setPosition('bottomright');
    }

    // Исправляем viewport
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
        viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5, viewport-fit=cover');
    }

    // --- 0. Создаём мобильную информационную панель ---
    const mobilePanel = document.createElement('div');
    mobilePanel.className = 'mobile-info-panel';
    mobilePanel.innerHTML = `<button class="close-btn">&times;</button><div class="panel-content"></div>`;
    document.body.appendChild(mobilePanel);
    
    mobilePanel.querySelector('.close-btn').addEventListener('click', () => {
        mobilePanel.classList.remove('visible');
        const arrow = document.getElementById('popup-arrow');
        if (arrow) arrow.style.display = 'none';
        if (map) map.closePopup();
    });

    // Переопределяем highlightMonument для мобильных
    window._mobileShowInfo = function(mon) {
        const content = mobilePanel.querySelector('.panel-content');
        let html = `<strong>${escapeHtml(mon.title)}</strong><br>`;
        if (mon.address) html += `📍 ${escapeHtml(mon.address)}<br>`;
        const conditionIcon = mon.condition === 'существует' ? '🔴' : (mon.condition === 'утрачен' ? '🔘' : '🔴');
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
        html += `<i>Координаты: ${mon.lat.toFixed(5)}, ${mon.lon.toFixed(5)}</i><br>`;
        if (mon.photoUrls && mon.photoUrls.length > 0) {
            html += `<div class="popup-container"><div class="photo-gallery">`;
            for (let i = 0; i < mon.photoUrls.length; i++) {
                html += `<img src="${mon.photoUrls[i]}" alt="Фото" class="gallery-thumb" data-full="${mon.photoUrls[i]}" loading="lazy">`;
            }
            html += `</div></div>`;
        }
        content.innerHTML = html;
        mobilePanel.classList.add('visible');
        
        // Создаём стрелочку над маркером
        let arrow = document.getElementById('popup-arrow');
        if (!arrow) {
            arrow = document.createElement('div');
            arrow.id = 'popup-arrow';
            document.body.appendChild(arrow);
        }
        arrow.style.display = 'block';
        
        // Перемещаем маркер вниз — на 30% от низа экрана
        const mapHeight = map.getSize().y;
        const shiftUp = mapHeight * 0.3;
        const topLeft = map.containerPointToLatLng([0, 0]);
        const bottomLeft = map.containerPointToLatLng([0, mapHeight]);
        const latPerPixel = (topLeft.lat - bottomLeft.lat) / mapHeight;
        const newCenterLat = mon.lat + shiftUp * latPerPixel;
        map.setView([newCenterLat, mon.lon], map.getZoom(), { animate: false });
        
        // Позиционируем popup — вытянут от 20% верха до маркера
        setTimeout(() => {
            const markerPoint = map.latLngToContainerPoint([mon.lat, mon.lon]);
            const mapHeight = map.getSize().y;
            const topLimit = mapHeight * 0.2; // 20% от верха
            const bottomLimit = markerPoint.y - 20; // 20px отступ от маркера
            
            // Высота панели — от верха до маркера
            const panelHeight = bottomLimit - topLimit;
            
            mobilePanel.style.top = topLimit + 'px';
            mobilePanel.style.height = panelHeight + 'px';
            mobilePanel.style.bottom = 'auto';
            
            // Позиционируем стрелочку над маркером
            arrow.style.top = (markerPoint.y - 14) + 'px';
            arrow.style.left = (markerPoint.x - 14) + 'px';
        }, 50);
    };

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

// Запуск
init();