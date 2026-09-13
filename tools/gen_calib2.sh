#!/bin/bash
# Вторая калибровка — уже со свободными генами (первая шла на модели без них).
# Две ступени, реплик по 4: это СКРИНИНГ, его задача — ранжировать точки и найти
# кандидатов в режимы, а не публиковать числа. Числа режима досчитываются отдельно
# на 8 мирах (правило из CLAUDE.md: под числом в подписи не меньше восьми миров).
# Мёртвые точки почти бесплатны: прогон обрывается на вымирании.
OUT="${1:?куда писать}"
: > "$OUT"
REP="${REP:-4}"
# ── A: 6 × 4 × 4 × 3 = 288 точек при штатных галочках
for L in 0.35 0.45 0.62 0.80 1.00 1.30; do
 for M in 0.04 0.12 0.30 0.60; do
  for D in 0.05 0.15 0.30 0.60; do
   for P in 0 1.0 2.0; do
    for r in $(seq 1 $REP); do
      echo "MODS=1 LIGHT=$L MUT=$M DECOMP=$D PAR=$P DAYNIGHT=1 PRED=1 SEX=1 SD=$((6000+r)) HOURS=12000"
    done
   done
  done
 done
done >> "$OUT"
# ── B: все 8 сочетаний галочек на 6 точках
for DN in 0 1; do for PR in 0 1; do for SX in 0 1; do
 for L in 0.45 0.62 1.00; do
  for M in 0.12 0.30; do
   for r in $(seq 1 $REP); do
     echo "MODS=1 LIGHT=$L MUT=$M DECOMP=0.30 PAR=1.0 DAYNIGHT=$DN PRED=$PR SEX=$SX SD=$((7000+r)) HOURS=12000"
   done
  done
 done
done; done; done >> "$OUT"
wc -l < "$OUT"
