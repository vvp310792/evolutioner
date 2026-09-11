#!/bin/bash
# Ночная калибровка целиком: решётка -> прогоны -> разбор на режимы -> сводка.
# Одной командой, потому что запускается на ночь и утром нужен готовый ответ,
# а не сырой CSV.
set -e
cd "$(dirname "$0")"
ARCHIVE="${EVO_ARCHIVE:-$HOME/claude_vvp/data/evolutioner}"
P="${P:-24}"
COMMIT=$(git rev-parse --short HEAD)
OUT="$ARCHIVE/$(date +%Y-%m-%d_%H%M)_калибровка_${COMMIT}"
mkdir -p "$OUT"
bash gen_calib.sh "$OUT/jobs.txt" > "$OUT/njobs.txt"
T0=$(date +%s)
{ cat calib_head.txt; grep -v '^$' "$OUT/jobs.txt" | xargs -P "$P" -I{} sh -c "env {} node calib.js"; } > "$OUT/runs.csv" 2> "$OUT/stderr.log"
T1=$(date +%s)
cat > "$OUT/manifest.json" <<JSON
{
  "опыт": "калибровка режимов",
  "вопрос": "какие режимы функционирования даёт решётка из четырёх ручек и трёх галочек",
  "коммит": "$COMMIT",
  "дерево_грязное_файлов": $(git status --porcelain | wc -l),
  "node": "$(node -v)",
  "хост": "$(hostname)",
  "ядер_занято": $P,
  "прогонов": $(($(wc -l < "$OUT/runs.csv") - 1)),
  "секунд": $((T1 - T0))
}
JSON
python3 regimes.py "$OUT/runs.csv" > "$OUT/СВОДКА.md" 2> "$OUT/regimes.err" || echo "разбор упал, см. regimes.err"
echo "ГОТОВО $OUT"
tail -c 400 "$OUT/manifest.json"
