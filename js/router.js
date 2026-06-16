// ==================== ХЕШ-РОУТИНГ (упрощённый) ====================

let isHandlingHashChange = false;

// Обработчик маршрутов
function handleRoute() {
    if (isHandlingHashChange) return;
    isHandlingHashChange = true;

    try {
        const hash = location.hash.slice(1) || '';
        const parts = hash.split('/').filter(Boolean);
        const route = parts[0] || '';
        const param = parts[1] || null;

        console.log(`🔀 Роутер: ${route}${param ? '/' + param : ''}`);

        if (route === 'monument' && param) {
            if (typeof window._highlightMonument === 'function') {
                window._highlightMonument(param);
            } else {
                console.warn('_highlightMonument ещё не определён');
            }
        } else if (route === 'quiz') {
            console.log('📌 Попытка открыть тест, _openQuiz =', window._openQuiz);
            if (typeof window._openQuiz === 'function') {
                window._openQuiz();
            } else {
                console.warn('_openQuiz ещё не определён');
            }
        } else {
            // Главный вид
            if (typeof window._showMainView === 'function') {
                window._showMainView();
            }
            if (typeof window._closeQuiz === 'function') {
                window._closeQuiz();
            }
        }
    } catch (e) {
        console.error('Ошибка роутинга:', e);
        location.hash = '#/';
    } finally {
        isHandlingHashChange = false;
    }
}

// Подписка на изменения хеша
function initRouter() {
    window.addEventListener('hashchange', handleRoute);
    // Обработка начальной загрузки
    if (!location.hash || location.hash === '#') {
        location.hash = '#/';
    } else {
        handleRoute();
    }
}

// API для навигации
window.router = {
    navigate: function(path) {
        const newHash = '#' + path;
        if (location.hash !== newHash) {
            location.hash = newHash;
        }
    },
    goHome: function() {
        this.navigate('/');
    },
    goToMonument: function(id) {
        this.navigate('/monument/' + id);
    },
    goToQuiz: function() {
        this.navigate('/quiz');
    }
};

// Запускаем роутер после загрузки DOM
document.addEventListener('DOMContentLoaded', initRouter);