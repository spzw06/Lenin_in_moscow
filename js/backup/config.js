// Локальная конфигурация: ручной выбор CSV-файла через кнопку
window.loadDataCustom = function() {
    const overlay = document.getElementById('loading-overlay');
    // Разрешаем клики по оверлею (переопределяем CSS)
    overlay.style.pointerEvents = 'auto';
    
    // Показываем оверлей с кнопкой выбора файла
    overlay.innerHTML = `
        <div style="text-align: center;">
            <div>📂 Для загрузки данных выберите CSV-файл</div>
            <button id="selectCsvBtn" style="margin-top: 15px; padding: 10px 24px; background: #2ecc71; border: none; border-radius: 30px; cursor: pointer; font-size: 1rem; font-weight: bold;">Выбрать файл</button>
        </div>
    `;
    overlay.style.display = 'flex';

    const btn = document.getElementById('selectCsvBtn');
    if (!btn) return;
    
    btn.onclick = function() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) {
                overlay.style.display = 'none';
                fileInput.remove();
                return;
            }

            overlay.innerHTML = '<div>📡 Загрузка данных...</div>';
            
            const reader = new FileReader();
            reader.onload = function(ev) {
                try {
                    const csvText = ev.target.result;
                    const data = window.parseCSV(csvText);
                    if (!data.length) throw new Error('Нет данных в CSV');
                    window.processDataFromCSV(data);
                    overlay.style.display = 'none';
                } catch (err) {
                    alert('Ошибка разбора CSV: ' + err.message);
                    overlay.style.display = 'none';
                } finally {
                    fileInput.remove();
                    // Восстанавливаем исходный pointer-events оверлея (если нужно)
                    overlay.style.pointerEvents = '';
                }
            };
            reader.onerror = function() {
                alert('Ошибка чтения файла');
                overlay.style.display = 'none';
                fileInput.remove();
                overlay.style.pointerEvents = '';
            };
            reader.readAsText(file, 'UTF-8');
        };
        fileInput.click();
    };
};