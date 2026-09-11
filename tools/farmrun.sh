#!/bin/bash
# Прогон матрицы С ПАСПОРТОМ. Единственный правильный способ считать на сервере:
# результат без пометки о версии кода бесполезен — прогоны с разных коммитов
# несопоставимы даже при одинаковом seed (проверено: лишний вызов генератора
# сдвигает весь поток, и «тот же» контрольный мир даёт 2654 тела вместо 569).
#
#   farmrun.sh ФАЙЛ_ЗАДАНИЙ ИМЯ_ОПЫТА "вопрос, на который отвечает опыт" [P]
#
# Кладёт в АРХИВ (по умолчанию ~/claude_vvp/data/evolutioner — это HDD):
#   <дата>_<имя>_<коммит>/runs.csv      данные, строка на прогон
#                        /jobs.txt      точный список заданий
#                        /manifest.json паспорт: коммит, чистота дерева, версия
#                                       node, ядра, время, вопрос опыта
set -e
cd "$(dirname "$0")"
JOBS="${1:?нужен файл заданий}"; NAME="${2:?нужно имя опыта}"; Q="${3:-}"; P="${4:-$(nproc)}"
ARCHIVE="${EVO_ARCHIVE:-$HOME/claude_vvp/data/evolutioner}"
COMMIT=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain | wc -l)
OUT="$ARCHIVE/$(date +%Y-%m-%d_%H%M)_${NAME}_${COMMIT}"
mkdir -p "$OUT"
cp "$JOBS" "$OUT/jobs.txt"
T0=$(date +%s)
./farm2.sh "$JOBS" "$P" > "$OUT/runs.csv" 2> "$OUT/stderr.log"
T1=$(date +%s)
cat > "$OUT/manifest.json" <<JSON
{
  "опыт": "$NAME",
  "вопрос": "$Q",
  "коммит": "$COMMIT",
  "дерево_грязное_файлов": $DIRTY,
  "node": "$(node -v)",
  "хост": "$(hostname)",
  "ядер_занято": $P,
  "прогонов": $(($(wc -l < "$OUT/runs.csv") - 1)),
  "секунд": $((T1 - T0)),
  "начало": "$(date -d @$T0 -Is)"
}
JSON
echo "$OUT"
grep -c . "$OUT/runs.csv" | xargs echo "строк в runs.csv:"
[ "$DIRTY" -gt 0 ] && echo "ВНИМАНИЕ: рабочее дерево грязное ($DIRTY файлов), коммит не описывает код прогона полностью"
exit 0
