// ==================== ТЕСТ (ВИКТОРИНА) ====================

let quizState = {
    isActive: false,           // открыто ли модальное окно
    questions: [],             // массив объектов вопроса: { photoUrl, correctAddress, options, correctIndex }
    currentIndex: 0,
    answers: [],               // массив boolean
    totalQuestions: 0,
    isFinished: false
};

let monumentsWithPhotos = [];   // кеш памятников, у которых есть фото
let allAddresses = [];          // все уникальные адреса (не пустые) для генерации вариантов
let dataReady = false;
let checkInterval = null;
let feedbackTimer = 3000; // в милисекундах
let pendingQuizRequest = false;

// Фразы для результата в зависимости от процента правильных ответов
const RESULT_PHRASES = [
    { min: 0, max: 20, title: "Ты знаешь памятники Ленину, как меньшевик — марксизм. Пора учиться!", quote: "«Учиться, учиться и ещё раз учиться» — В. И. Ленин" },
    { min: 21, max: 40, title: "Ты в начале пути, как молодой Ильич в Симбирской гимназии.", quote: "«Мы пойдём другим путём» (приписывается юному Володе Ульянову)" },
    { min: 41, max: 60, title: "Крестьянин ты, батенька, в вопросе монументов. Но потенциал есть!", quote: "«Лучше меньше, да лучше» — В. И. Ленин" },
    { min: 61, max: 80, title: "Неплохо! Ты знаешь памятники почти как Надежда Константиновна знала привычки Ильича.", quote: "«Искусство принадлежит народу» — В. И. Ленин" },
    { min: 81, max: 100, title: "Ты — настоящий ленинец-монументовед! Прямо как Дзержинский, который не упускал ни одной детали.", quote: "«Есть такая партия!» — В. И. Ленин" }
];

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Получить все памятники с фото и не пустым адресом
function updateMonumentsWithPhotos() {
    if (!window.allMonuments || window.allMonuments.length === 0) {
        monumentsWithPhotos = [];
        return;
    }
    monumentsWithPhotos = window.allMonuments.filter(mon => 
        mon.photoUrls && mon.photoUrls.length > 0 && mon.address && mon.address.trim() !== ''
    );
    // Обновить список всех адресов (для вариантов ответов)
    allAddresses = window.allMonuments
        .map(mon => mon.address)
        .filter(addr => addr && addr.trim() !== '');
}

// Генерация вопросов для теста (максимум 10)
function generateQuizQuestions() {
    if (monumentsWithPhotos.length === 0) return [];
    
    // Перемешиваем и берём не более 10 памятников
    const shuffled = shuffleArray([...monumentsWithPhotos]);
    const selected = shuffled.slice(0, Math.min(10, shuffled.length));
    const questions = [];
    
    for (const monument of selected) {
        const correctAddress = monument.address.trim();
        // Получаем 3 случайных адреса из всех адресов (исключая правильный)
        let candidates = allAddresses.filter(addr => addr !== correctAddress);
        candidates = shuffleArray([...candidates]);
        let wrongAddresses = candidates.slice(0, 3);
        // Если вдруг меньше 3 адресов (маловероятно, но добавим fallback)
        while (wrongAddresses.length < 3) {
            wrongAddresses.push("Адрес не указан");
        }
        
        const options = [correctAddress, ...wrongAddresses];
        shuffleArray(options);
        const correctIndex = options.indexOf(correctAddress);
        
        questions.push({
            photoUrl: monument.photoUrls[0], // берём первое фото
            correctAddress: correctAddress,
            options: options,
            correctIndex: correctIndex
        });
    }
    return questions;
}

// Сброс состояния теста
function resetQuiz() {
    const questions = generateQuizQuestions();
    quizState.questions = questions;
    quizState.totalQuestions = questions.length;
    quizState.currentIndex = 0;
    quizState.answers = [];
    quizState.isFinished = false;
    quizState.isActive = true;
    
    if (quizState.totalQuestions === 0) {
        alert("Нет памятников с фотографиями для теста. Попробуйте позже.");
        closeQuizModal();
        return;
    }
    
    renderQuizProgress();
    renderCurrentQuestion();
    showQuestionContainer();
    hideResultScreen();
}

// Рендер шкалы прогресса
function renderQuizProgress() {
    const progressContainer = document.getElementById('quiz-progress');
    if (!progressContainer) return;
    
    progressContainer.innerHTML = '';
    for (let i = 0; i < quizState.totalQuestions; i++) {
        const segment = document.createElement('div');
        segment.classList.add('quiz-progress-segment');
        if (i < quizState.answers.length) {
            if (quizState.answers[i] === true) {
                segment.classList.add('correct');
            } else if (quizState.answers[i] === false) {
                segment.classList.add('wrong');
            }
        }
        if (i === quizState.currentIndex && !quizState.isFinished) {
            segment.classList.add('active');
        }
        progressContainer.appendChild(segment);
    }
}

// --- НОВАЯ ФУНКЦИЯ ДЛЯ ПРЕДЗАГРУЗКИ ИЗОБРАЖЕНИЙ ---
function preloadImage(url) {
    if (!url) return;
    const img = new Image();
    img.src = url;
}

// Показать текущий вопрос
function renderCurrentQuestion() {
    if (feedbackTimer) {
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
    }

    // Скрываем фидбек
    const feedbackEl = document.getElementById('quiz-feedback');
    if (feedbackEl) {
        feedbackEl.style.display = 'none';
        feedbackEl.className = 'quiz-feedback';
    }

    if (quizState.isFinished || quizState.currentIndex >= quizState.totalQuestions) {
        finishQuiz();
        return;
    }

    const question = quizState.questions[quizState.currentIndex];
    if (!question) return;

    const photoImg = document.getElementById('quiz-photo');
    const optionsContainer = document.getElementById('quiz-options');

    if (photoImg) {
        // Предзагрузка следующего фото
        if (quizState.currentIndex + 1 < quizState.totalQuestions) {
            const nextQ = quizState.questions[quizState.currentIndex + 1];
            if (nextQ) preloadImage(nextQ.photoUrl);
        }
        photoImg.src = question.photoUrl;
    }

    if (optionsContainer) {
        optionsContainer.innerHTML = '';
        question.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'quiz-option-btn';
            btn.textContent = opt;
            btn.dataset.index = idx;
            btn.addEventListener('click', () => handleAnswer(idx));
            optionsContainer.appendChild(btn);
        });
    }

    renderQuizProgress();
}

function handleAnswer(selectedIdx) {
    if (quizState.isFinished) return;
    if (feedbackTimer) return;

    const currentQ = quizState.questions[quizState.currentIndex];
    const isCorrect = (selectedIdx === currentQ.correctIndex);

    quizState.answers.push(isCorrect);

    const btns = document.querySelectorAll('.quiz-option-btn');
    btns.forEach((btn, idx) => {
        btn.classList.add('disabled');
        if (idx === selectedIdx) {
            btn.classList.add('selected');
            if (isCorrect) {
                btn.classList.add('correct');
            } else {
                btn.classList.add('wrong');
            }
        }
        if (idx === currentQ.correctIndex && !isCorrect) {
            btn.classList.add('correct');
        }
    });

    // Показываем фидбек поверх фото
    const feedbackEl = document.getElementById('quiz-feedback');
    if (feedbackEl) {
        if (isCorrect) {
            feedbackEl.textContent = '✅ Верно!';
            feedbackEl.className = 'quiz-feedback correct';
        } else {
            const correctAddress = currentQ.options[currentQ.correctIndex];
            feedbackEl.textContent = `❌ Неверно! Правильный ответ: ${correctAddress}`;
            feedbackEl.className = 'quiz-feedback wrong';
        }
        feedbackEl.style.display = 'flex';  // используем flex для центрирования
    }

    // Предзагрузка следующего фото (на всякий случай)
    if (quizState.currentIndex + 1 < quizState.totalQuestions) {
        const nextQ = quizState.questions[quizState.currentIndex + 1];
        if (nextQ) preloadImage(nextQ.photoUrl);
    }

    renderQuizProgress();

    feedbackTimer = setTimeout(() => {
        feedbackTimer = null;
        quizState.currentIndex++;
        if (quizState.currentIndex < quizState.totalQuestions) {
            renderCurrentQuestion();
        } else {
            finishQuiz();
        }
    }, 1500);
}

// Завершение теста, показ результата
function finishQuiz() {
    quizState.isFinished = true;
    const total = quizState.totalQuestions;
    const correctCount = quizState.answers.filter(a => a === true).length;
    const percent = (correctCount / total) * 100;
    
    // Находим подходящую фразу
    let phraseObj = RESULT_PHRASES[0];
    for (const p of RESULT_PHRASES) {
        if (percent >= p.min && percent <= p.max) {
            phraseObj = p;
            break;
        }
    }
    
    const resultScoreElem = document.getElementById('quiz-result-score');
    const resultPhraseElem = document.getElementById('quiz-result-phrase');
    if (resultScoreElem) {
        resultScoreElem.innerHTML = `✅ Ты ответил правильно на ${correctCount} из ${total} вопросов (${Math.round(percent)}%)`;
    }
    if (resultPhraseElem) {
        resultPhraseElem.innerHTML = `<strong>${phraseObj.title}</strong><br><br><q>${phraseObj.quote}</q>`;
    }
    
    showResultScreen();
    hideQuestionContainer();
    renderQuizProgress(); // обновить финальную шкалу
}

// Перезапуск теста
function restartQuiz() {
    resetQuiz();
}

// Вспомогательные функции UI
function showQuestionContainer() {
    const qContainer = document.getElementById('quiz-question-container');
    const resultScreen = document.getElementById('quiz-result-screen');
    if (qContainer) qContainer.style.display = 'block';
    if (resultScreen) resultScreen.style.display = 'none';
}

function hideQuestionContainer() {
    const qContainer = document.getElementById('quiz-question-container');
    if (qContainer) qContainer.style.display = 'none';
}

function showResultScreen() {
    const qContainer = document.getElementById('quiz-question-container');
    const resultScreen = document.getElementById('quiz-result-screen');
    if (qContainer) qContainer.style.display = 'none';
    if (resultScreen) resultScreen.style.display = 'block';
}

function hideResultScreen() {
    const resultScreen = document.getElementById('quiz-result-screen');
    if (resultScreen) resultScreen.style.display = 'none';
}

// Привязка событий к элементам интерфейса
function bindQuizEvents() {
    const startBtn = document.getElementById('start-test-btn');
    if (startBtn) {
        startBtn.disabled = true;          // кнопка неактивна до загрузки
        startBtn.addEventListener('click', openQuizModal);
    }
    const closeBtn = document.querySelector('.quiz-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeQuizModal);
    const retryBtn = document.getElementById('quiz-retry-btn');
    if (retryBtn) retryBtn.addEventListener('click', restartQuiz);
    const modal = document.getElementById('quiz-modal');
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeQuizModal(); });
}

// Инициализация – ждём появления window.allMonuments
document.addEventListener('DOMContentLoaded', () => {
    bindQuizEvents();
    checkInterval = setInterval(() => {
        if (window.allMonuments && window.allMonuments.length > 0) {
            clearInterval(checkInterval);
            updateMonumentsWithPhotos();
            const startBtn = document.getElementById('start-test-btn');
            if (startBtn) startBtn.disabled = false;   // активируем кнопку
            console.log(`✅ Тест готов: найдено памятников с фото: ${monumentsWithPhotos.length}`);
        }
    }, 300);
});


// Переопределяем openQuizModal для работы с роутером
openQuizModal = function() {
	console.log('🧪 openQuizModal вызван, pendingQuizRequest =', pendingQuizRequest);
    // Если данные ещё не загружены – сохраняем запрос и выходим
    if (!window.allMonuments || window.allMonuments.length === 0) {
        console.warn('Данные не загружены, откладываем открытие теста');
        pendingQuizRequest = true;
        return;
    }
    // Если уже открыт – не дублируем
    if (document.getElementById('quiz-modal')?.style.display === 'flex') {
        return;
    }
    // Если данные не загружены – пробуем обновить
    if (!window.allMonuments || window.allMonuments.length === 0) {
        alert("Данные ещё загружаются. Пожалуйста, подождите пару секунд и попробуйте снова.");
        return;
    }
    updateMonumentsWithPhotos();
    if (monumentsWithPhotos.length === 0) {
        alert("Нет памятников с фотографиями для викторины :(");
        return;
    }
    // Открываем модалку
    const modal = document.getElementById('quiz-modal');
    if (modal) {
        modal.style.display = 'flex';
        resetQuiz();
    }
    // Устанавливаем хеш, если ещё не установлен
    if (window.router && location.hash !== '#/quiz') {
        window.router.navigate('/quiz');
    }
};

// Переопределяем closeQuizModal для работы с роутером
closeQuizModal = function() {
	console.log('🧪 closeQuizModal');
    pendingQuizRequest = false;
    const modal = document.getElementById('quiz-modal');
    if (modal) modal.style.display = 'none';
    quizState.isActive = false;
    // Если текущий хеш – #/quiz, возвращаем на главную
    if (location.hash === '#/quiz' && window.router) {
        window.router.goHome();
    }
};


// Переопределяем кнопку запуска теста, чтобы она меняла хеш
// В bindQuizEvents изменяем обработчик
const originalBind = bindQuizEvents;
bindQuizEvents = function() {
    // Вызываем оригинальную привязку, но потом переопределяем обработчик кнопки
    originalBind();
    const startBtn = document.getElementById('start-test-btn');
    if (startBtn) {
        // Убираем старый обработчик и ставим новый – через роутер
        const newBtn = startBtn.cloneNode(true);
        startBtn.parentNode.replaceChild(newBtn, startBtn);
        newBtn.addEventListener('click', function() {
            if (window.router) {
                window.router.goToQuiz();
            } else {
                openQuizModal();
            }
        });
        newBtn.disabled = false; // активируем, если данные уже загружены
    }
};

window._checkPendingQuiz = function() {
    console.log('📌 _checkPendingQuiz вызван, pendingQuizRequest =', pendingQuizRequest);
    if (pendingQuizRequest) {
        pendingQuizRequest = false;
        openQuizModal();
    }
};

// Убеждаемся, что _openQuiz назначен
window._openQuiz = openQuizModal;
window._closeQuiz = closeQuizModal;
console.log('🧪 _openQuiz и _closeQuiz назначены');
