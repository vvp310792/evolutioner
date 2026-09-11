#!/bin/bash
# Список заданий для ночной калибровки. Две ступени:
#  A — полная решётка по четырём ручкам при штатных галочках (день/ночь, хищничество, пол);
#  B — все восемь сочетаний галочек на сокращённой решётке, чтобы увидеть их влияние.
# Реплик по 3: для непрерывных мер этого хватает (см. tools/README, раздел о выборке).
OUT="${1:?куда писать}"
: > "$OUT"
REP="${REP:-3}"
# ── A: 7 × 4 × 4 × 4 = 448 точек
for L in 0.35 0.45 0.55 0.62 0.80 1.00 1.30; do
 for M in 0.04 0.12 0.30 0.60; do
  for D in 0.05 0.15 0.30 0.60; do
   for P in 0 0.5 1.0 2.0; do
    for r in $(seq 1 $REP); do
      echo "STAGE=A LIGHT=$L MUT=$M DECOMP=$D PAR=$P DAYNIGHT=1 PRED=1 SEX=1 SD=$((1000+r)) HOURS=12000"
    done
   done
  done
 done
done >> "$OUT"
# ── B: 8 сочетаний галочек × 24 точки
for DN in 0 1; do for PR in 0 1; do for SX in 0 1; do
 for L in 0.45 0.62 1.00; do
  for M in 0.12 0.30; do
   for D in 0.15 0.30; do
    for P in 0 1.0; do
     for r in $(seq 1 $REP); do
       echo "STAGE=B LIGHT=$L MUT=$M DECOMP=$D PAR=$P DAYNIGHT=$DN PRED=$PR SEX=$SX SD=$((2000+r)) HOURS=12000"
     done
    done
   done
  done
 done
done; done; done >> "$OUT"
wc -l < "$OUT"
