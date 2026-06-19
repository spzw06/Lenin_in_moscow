# Памятники Ленину в Москве / Lenin's Monuments in Moscow

[![Live Demo](https://img.shields.io/badge/demo-ильичвмоскве.рф-cc0000?style=for-the-badge&logo=githubpages)](https://ильичвмоскве.рф)
[![GitHub Pages](https://img.shields.io/badge/GitHub_Pages-spzw06.github.io/Lenin_in_moscow-2ecc71?style=for-the-badge&logo=github)](https://spzw06.github.io/Lenin_in_moscow)

Интерактивная карта памятников В. И. Ленину в Москве с фильтрацией, викториной и возможностью поделиться ссылкой на конкретный объект.

Interactive map of Lenin's monuments in Moscow with filtering, a quiz, and shareable links to individual objects.

---

## 📩 Обратная связь / Feedback

Если вы нашли неточность, знаете о памятнике, которого нет на карте, или хотите предложить улучшение, заполните форму:

👉 [**Сообщить о памятнике / уточнить / связаться**](https://forms.gle/rYFZ2PjYjWTWyrYA9)

Форма принимает:
- информацию о новых памятниках (название, адрес, координаты, фото);
- уточнения по уже отмеченным объектам;
- любые другие замечания и предложения по проекту.

- ---

## 📖 Описание / Description

**Русский**  
Проект представляет собой одностраничное приложение (SPA) с картой Москвы, на которую нанесены памятники Ленину. Данные собраны из открытых источников. Реализованы:

- Фильтрация по статусу (существует / утрачен)
- Фильтрация по типу (фигура / бюст), скульптору и наличию фото
- Боковая панель со списком памятников и поиском по названию/адресу
- Викторина «Насколько хорошо ты знаешь памятники Ленину?» (10 вопросов с фото)
- Хеш-роутинг — можно делиться ссылками на конкретный памятник (`#/monument/123`) или на викторину (`#/quiz`)
- Адаптивный дизайн для мобильных устройств (в разработке)
- Кластеризация маркеров для удобства просмотра

**English**  
This is a single-page application (SPA) featuring a map of Moscow with Lenin monuments marked. Data is collected from open sources. Features include:

- Filtering by status (existing / lost)
- Filtering by type (statue / bust), sculptor, and photo availability
- A sidebar with a full list of monuments and search by name/address
- A quiz "How well do you know Lenin's monuments?" (10 questions with photos)
- Hash-based routing — shareable links to a specific monument (`#/monument/123`) or the quiz (`#/quiz`)
- Responsive design for mobile devices (in progress)
- Marker clustering for better map readability

---

## 🚀 Демо / Live Demo

| Ссылка / Link | Описание / Description |
|---------------|------------------------|
| [**ильичвмоскве.рф**](https://ильичвмоскве.рф) | Основной домен (перенаправляет на GitHub Pages) |
| [**spzw06.github.io/Lenin_in_moscow**](https://spzw06.github.io/Lenin_in_moscow) | Прямая ссылка на GitHub Pages |

---

## 🗂️ Источники данных / Data Sources

Данные собраны из следующих открытых источников:

- [leninstatues.ru](https://web.archive.org/web/20250613224843/http://leninstatues.ru/moscow) (архивная копия)
- [Yandex Maps](https://yandex.ru/maps/)
- [Wikimapia](https://wikimapia.org/)
- [PastVu](https://pastvu.com/)

Координаты и атрибуты памятников находятся в файле [`data/lenin_monuments_coords.csv`](data/lenin_monuments_coords.csv).  
Фотографии — в папке [`data/images/`](data/images/).

---

## 🛠️ Локальный запуск / Local Setup

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/spzw06/Lenin_in_moscow.git
   cd Lenin_in_moscow
   ```

2. Откройте файл `index.html` в браузере.  
   Для удобной разработки можно использовать расширение Live Server в VS Code.

> **Примечание:** для работы карты требуется интернет-соединение (загрузка Leaflet и картографических тайлов).

---

## 📁 Структура проекта / Project Structure

```
Lenin_in_moscow/
├── css/
│   └── style.css          # Основные стили
├── data/
│   ├── assets/            # SVG-иконки для маркеров
│   ├── images/            # Фотографии памятников
│   └── lenin_monuments_coords.csv  # База данных памятников
├── js/
│   ├── script.js          # Основная логика карты и фильтров
│   ├── test.js            # Логика викторины
│   └── router.js          # Хеш-роутинг
├── index.html             # Главная страница
└── README.md              # Этот файл
```

---

## 🧠 Викторина / Quiz

В викторине предлагается 10 случайных вопросов: по фотографии нужно выбрать правильный адрес памятника из четырёх вариантов. После каждого ответа показывается фидбек, а в конце — результат с тематической цитатой Ленина.

The quiz offers 10 random questions: based on a photo, you must choose the correct address from four options. After each answer, feedback is shown, and at the end — a result with a thematic Lenin quote.

---

## 🤝 Вклад / Contributing

Если вы хотите дополнить базу данных или улучшить код — создавайте Issue или Pull Request.

If you'd like to add data or improve the code — feel free to open an Issue or Pull Request.

---

## 📄 Лицензия / License

Проект распространяется под лицензией MIT. Подробнее см. файл [LICENSE](LICENSE) (если добавлен).

This project is distributed under the MIT License. See the [LICENSE](LICENSE) file for details (if added).

---

## 🙏 Благодарности / Acknowledgements

- [Leaflet](https://leafletjs.com/) — интерактивные карты
- [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) — кластеризация маркеров
- [CartoDB](https://carto.com/) — базовые тайлы
- Все авторы фотографий и источников данных
