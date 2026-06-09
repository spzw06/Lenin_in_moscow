// ==================== НАСТРОЙКИ ====================
const CSV_URL = (typeof window !== 'undefined' && window.DEF_CSV_URL) || 'data/lenin_monuments_coords.csv';

let map;
let markersCluster;
let allMonuments = [];
let currentFilter = 'all';
let markerMap = new Map();
let photoAttribution = {}; // словарь: имя файла -> { author, source, title }
let sidebarVisible = false;
let searchQuery = '';
let currentFilteredList = [];

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
    map = L.map('map').setView([55.7558, 37.6176], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
        subdomains: 'abcd', maxZoom: 18, minZoom: 9
    }).addTo(map);
    markersCluster = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 35,
        disableClusteringAtZoom: 15
    });
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
    console.log('✅ Загружено точек:', validPoints);
    console.log('⚠️ Пропущено всего:', data.length - validPoints);
    console.log('📋 Детали пропущенных:', skipped);
    document.getElementById('totalCount').innerText = validPoints;
    if (validPoints === 0) {
        alert('⚠️ Не найдено точек с координатами. Проверьте консоль для деталей.');
        return;
    }
    displayMonuments(allMonuments);
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
    updateSidebarIfVisible();
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
    let filtered = filterValue === 'all' ? allMonuments : allMonuments.filter(m => m.condition === filterValue);
    displayMonuments(filtered);
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.getAttribute('data-filter') === filterValue) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    updateSidebarIfVisible();
}

function updateFilterCounter() {
    const allCount = allMonuments.length;
    const existsCount = allMonuments.filter(m => m.condition === 'существует').length;
    const lostCount = allMonuments.filter(m => m.condition === 'утрачен').length;
    const allBtn = document.querySelector('.filter-btn[data-filter="all"]');
    const existsBtn = document.querySelector('.filter-btn[data-filter="существует"]');
    const lostBtn = document.querySelector('.filter-btn[data-filter="утрачен"]');
    if (allBtn) allBtn.innerHTML = `Все точки (${allCount})`;
    if (existsBtn) existsBtn.innerHTML = `🔴 Существующие (${existsCount})`;
    if (lostBtn) lostBtn.innerHTML = `🔘 Утраченные (${lostCount})`;
}

function bindFilterButtons() {
    document.querySelector('.filter-btn[data-filter="all"]')?.addEventListener('click', () => applyFilter('all'));
    document.querySelector('.filter-btn[data-filter="существует"]')?.addEventListener('click', () => applyFilter('существует'));
    document.querySelector('.filter-btn[data-filter="утрачен"]')?.addEventListener('click', () => applyFilter('утрачен'));
    document.querySelector('.filter-btn[data-filter="reset"]')?.addEventListener('click', () => applyFilter('all'));
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
            if (container) {
                const fullText = container.getAttribute('data-full');
                if (fullText) {
                    container.innerHTML = `📖 ${fullText}`;
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

    let filtered = allMonuments;

    if (currentFilter !== 'all') {
        filtered = filtered.filter(
            m => m.condition === currentFilter
        );
    }

    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();

        filtered = filtered.filter(m =>
            [
                m.title,
                m.address,
                m.sculptor,
                m.year,
                m.description
            ]
            .join(' ')
            .toLowerCase()
            .includes(q)
        );
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

				document
					.querySelectorAll('.list-card')
					.forEach(c => c.classList.remove('active'));

				card.classList.add('active');

				const marker = markerMap.get(mon.id);

				if (marker) {
					markersCluster.zoomToShowLayer(
						marker,
						() => marker.openPopup()
					);
				}

				
				map.setView(
						[mon.lat, mon.lon],
						16
					);
				
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
        renderList();
    }
}

function updateSidebarIfVisible() {
    if (sidebarVisible) {
        renderList();
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
    // if (typeof window.loadDataCustom === 'function') {
        // window.loadDataCustom();
    // } else {
        // await loadData();
    // }
	await loadData();
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
            if (sidebarVisible) renderList();
        });
    }
    console.log('init: завершено');
}

window.parseCSV = parseCSV;
window.processDataFromCSV = processDataFromCSV;

// Запуск
init();