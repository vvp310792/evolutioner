#!/bin/bash
# Как farm.sh, но скрипт прогона выбирается переменной RUNNER в строке задания.
cd "$(dirname "$0")"
JOBS="${1:?}"; P="${2:-$(nproc)}"
echo "label,seed,light,pdmg,dorm,extinct_h,org,photo,herb,pred,sapro,vir,virSd,inf,imm,keySd,dormAvg,myco,mycoShare,dioecy,sexShare,seeds,spores,eggs,hits"
grep -v "^#" "$JOBS" | grep -v "^$" | xargs -P "$P" -I{} sh -c "env {} node \$(echo {} | grep -o \"RUNNER=[a-z0-9]*\" | cut -d= -f2).js"
