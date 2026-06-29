import os
import json
import re
import csv
import time
import PIL.Image
from google import genai
from google.genai import types
from google.colab import userdata

# ================== НАСТРОЙКИ ==================
MAX_IMAGES = 5          # 0 = все
IMAGES_DIR = '/content/Lenin_in_moscow/data/images'
OUTPUT_CSV = 'results.csv'
MODEL_NAME = 'gemini-3.1-flash-lite'  # или gemini-2.0-flash
MODEL_RPM = 15 # Максимальное кол-во запросов в минуту для данной модели
BASE_SLEEP_TIME = int(60/MODEL_RPM) # Фиксируем время сна между запросами

# Явный список всех тегов, которые мы ожидаем от модели (из промпта)
EXPECTED_KEYS = [
    "бюст", "поясной", "в_полный_рост", "сидит", "стоит",
    "рука_вытянута_вперёд", "рука_поднята_вверх", "рука_согнута_в_локте",
    "рука_в_кармане", "рука_за_спиной", "рука_на_постаменте",
    "рука_сжимает_кепку", "кепка_в_руке", "в_кепке", "без_головного_убора",
    "пальто", "костюм", "пальто_нараспашку", "галстук",
    "усы_и_бородка", "в_очках", "с_книгой_или_свитком",
    "скульптурная_группа", "нет_ленина", "повреждён",
    "окрашен_или_вандализирован", "молодой_ленин", "взрослый_ленин"
]

# ================== КЛЮЧ API ==================
try:
    api_key = userdata.get('GEMINI_API_KEY')
except:
    api_key = globals().get('api_key')

if not api_key:
    print("Ошибка: Ключ API не найден.")
    raise SystemExit("Нет ключа API")

client = genai.Client(api_key=api_key)

# ================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==================
def extract_retry_delay_from_error(error_str):
    match = re.search(r'"retryDelay"\s*:\s*"([\d.]+)s"', error_str)
    if match:
        return float(match.group(1))
    match = re.search(r'Please retry in ([\d.]+)s', error_str)
    if match:
        return float(match.group(1))
    return None

def is_daily_quota_exceeded(error_str):
    if "free_tier_requests" in error_str and "limit: 0" in error_str:
        return True
    if "GenerateRequestsPerDayPerProjectPerModel-FreeTier" in error_str:
        return True
    return False

# ================== ФУНКЦИЯ АНАЛИЗА (GEMINI) ==================
def analyze_image_with_gemini(image_path):
    img = PIL.Image.open(image_path)
    img.thumbnail((1500, 1500))

    prompt = (
        "Ты — эксперт по советским памятникам. На фото почти наверняка изображён памятник Ленину. "
        "Проанализируй изображение и для каждого из перечисленных ниже тегов определи, верен ли он для этого памятника. "
        "Верни ответ строго в формате JSON, где ключ — название тега (как в списке), значение — true или false.\n\n"
        "Список тегов и их определения:\n"
        "- бюст: погрудное или оплечное скульптурное изображение (только голова и плечи).\n"
        "- поясной: фигура обрезана на уровне пояса (полуростовая композиция).\n"
        "- в_полный_рост: стоящая или идущая фигура в полный рост.\n"
        "- сидит: Ленин в сидячей позе (на скамье, в кресле).\n"
        "- стоит: вертикальное положение тела (основная поза).\n"
        "- рука_вытянута_вперёд: классический указывающий жест (обычно правая рука).\n"
        "- рука_поднята_вверх: жест призыва или приветствия.\n"
        "- рука_согнута_в_локте: рука согнута, но не в кармане (часто придерживает борт пальто).\n"
        "- рука_в_кармане: кисть спрятана в карман брюк или пальто.\n"
        "- рука_за_спиной: одна или обе руки заведены за спину.\n"
        "- рука_на_постаменте: Ленин опирается на трибуну, столб или другую конструкцию.\n"
        "- рука_сжимает_кепку: кепка зажата в пальцах (часто в опущенной или заведённой за спину руке).\n"
        "- кепка_в_руке: кепка находится в руке, а не на голове.\n"
        "- в_кепке: на голове классическая кепка-«ленинка».\n"
        "- без_головного_убора: голова непокрыта.\n"
        "- пальто: одет в классическое длинное пальто.\n"
        "- костюм: виден пиджак/костюм-тройка (актуально для бюстов и сидячих фигур).\n"
        "- пальто_нараспашку: пальто не застёгнуто, полы расходятся.\n"
        "- галстук: виден галстук (характерно для бюстов в костюме).\n"
        "- усы_и_бородка: присутствует узнаваемая растительность на лице.\n"
        "- в_очках: Ленин в очках (редко, но бывает на ранних или стилизованных памятниках).\n"
        "- с_книгой_или_свитком: в руке книга, тетрадь или бумаги.\n"
        "- скульптурная_группа: Ленин изображён не один, а с другими людьми (рабочими, детьми, Горьким).\n"
        "- нет_ленина: постамент пуст, памятник демонтирован или на фото случайно другой объект.\n"
        "- повреждён: сколы, отсутствуют части тела, трещины.\n"
        "- окрашен_или_вандализирован: на памятнике заметны следы краски, граффити или другие следы вандализма.\n"
        "- молодой_ленин: юношеские или молодые черты (есть волосы на голове, меньше морщин, отсутствуют глубокие залысины).\n"
        "- взрослый_ленин: классический узнаваемый образ (выраженные залысины, усы и бородка, возрастные складки лица).\n\n"
        "Важно: если вы не уверены в каком-то теге, ставьте false. Не добавляйте пояснений, только чистый JSON без лишнего текста."
    )

    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.0
    )

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=[prompt, img],
        config=config
    )

    raw_text = response.text.strip()
    if not raw_text:
        raise ValueError("Пустой ответ от модели")

    raw_text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', raw_text)

    start = raw_text.find('{')
    end = raw_text.rfind('}') + 1
    if start == -1 or end == 0:
        raise ValueError("JSON не найден в ответе модели")
    json_str = raw_text[start:end]

    return json.loads(json_str)

# ================== ФУНКЦИЯ С ПОВТОРНЫМИ ПОПЫТКАМИ ==================
def analyze_with_retry(image_path, max_attempts=10):
    for attempt in range(max_attempts):
        try:
            return analyze_image_with_gemini(image_path)
        except Exception as e:
            error_str = str(e)

            if is_daily_quota_exceeded(error_str):
                print("❌ Дневная квота бесплатных запросов исчерпана. Дождитесь сброса в полночь по тихоокеанскому времени.")
                print("   Статус использования: https://ai.dev/rate-limit")
                print(f"   Ошибка: {e}")
                raise SystemExit("Дневная квота превышена, скрипт остановлен.")

            if "429" in error_str and "RESOURCE_EXHAUSTED" in error_str:
                retry_delay = extract_retry_delay_from_error(error_str)
                if retry_delay is not None:
                    if retry_delay > 120:
                        print(f"⏳ Ожидание слишком велико ({retry_delay:.1f} с > 120). Завершаем.")
                        raise SystemExit("Слишком большая задержка, скрипт остановлен.")
                    wait_time = retry_delay + 1.0
                    print(f"🔄 Достигнут минутный лимит. Повторная попытка через {wait_time:.1f} секунд...")
                    time.sleep(wait_time)
                else:
                    wait_time = (2 ** attempt) + 1
                    print(f"🔄 Лимит запросов, но retryDelay не найден. Ждём {wait_time} секунд...")
                    time.sleep(wait_time)
            else:
                raise e

    raise RuntimeError("Не удалось выполнить запрос после нескольких попыток из-за превышения квоты.")

# ================== ОСНОВНАЯ ЛОГИКА ==================
def main():
    if not os.path.exists(IMAGES_DIR):
        print(f"Папка {IMAGES_DIR} не найдена.")
        return

    extensions = ('.png', '.jpg', '.jpeg', '.webp')
    all_files = [f for f in os.listdir(IMAGES_DIR) if f.lower().endswith(extensions)]
    all_files.sort()

    if not all_files:
        print("В указанной папке нет изображений.")
        return

    if MAX_IMAGES > 0:
        selected_files = all_files[:MAX_IMAGES]
    else:
        selected_files = all_files

    print(f"Найдено {len(all_files)} изображений. Будет обработано: {len(selected_files)}.")

    # ---------- ПОДГОТОВКА CSV (заголовки) ----------
    # Поля: filename, все EXPECTED_KEYS, error
    fieldnames = ["filename"] + EXPECTED_KEYS + ["error"]

    # Открываем файл для записи (перезаписываем старый)
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8-sig') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()

    # Теперь будем дописывать строки в цикле
    # Открываем в режиме добавления ('a')
    csvfile = open(OUTPUT_CSV, 'a', newline='', encoding='utf-8-sig')
    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

    try:
        for idx, filename in enumerate(selected_files, 1):
            image_path = os.path.join(IMAGES_DIR, filename)
            print(f"\nОбработка {idx}/{len(selected_files)}: {filename}")

            # Строка для записи (все ключи по умолчанию пустые)
            row = {key: '' for key in fieldnames}
            row["filename"] = filename

            try:
                analysis = analyze_with_retry(image_path)
                # Заполняем row значениями из анализа
                for key in EXPECTED_KEYS:
                    row[key] = analysis.get(key, '')  # если ключа нет — пусто
                print(json.dumps(analysis, ensure_ascii=False, indent=2))
            except Exception as e:
                error_msg = repr(e)
                print(f"  ❌ Ошибка при обработке {filename}: {error_msg}")
                row["error"] = error_msg

            # Записываем строку в CSV
            writer.writerow(row)
            csvfile.flush()  # принудительно сбрасываем на диск

            # Базовая пауза между запросами
            time.sleep(BASE_SLEEP_TIME)

    finally:
        csvfile.close()

    print(f"\n✅ Анализ завершён. Результаты сохранены в {OUTPUT_CSV}")

if __name__ == "__main__":
    main()