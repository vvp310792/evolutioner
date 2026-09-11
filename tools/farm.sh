#!/bin/bash
# Матрица прогонов: одна строка CSV на прогон, P штук параллельно.
# farm.sh ФАЙЛ_ЗАДАНИЙ [P]   — каждая строка файла это набор VAR=VAL через пробел
cd "$(dirname "$0")"
JOBS="${1:?нужен файл заданий}"; P="${2:-$(nproc)}"
echo "label,seed,light,pdmg,dorm,extinct_h,org,photo,herb,pred,sapro,vir,virSd,inf,imm,keySd,dormAvg,dioecy,sexShare,seeds,spores,eggs,secs"
grep -v "^#" "$JOBS" | grep -v "^$" | xargs -P "$P" -I{} sh -c "env {} node run1.js"
