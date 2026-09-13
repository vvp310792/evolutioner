#!/usr/bin/env python3
"""Разбор калибровки на РЕЖИМЫ и подбор пресетов.

Классификация не слепая кластеризация, а явные правила: у режима должно быть
имя, которое можно объяснить словами, иначе пресет нечем подписать.
"""
import csv, sys, statistics as st
from collections import defaultdict

rows = list(csv.DictReader(open(sys.argv[1])))
def f(r, k):
    try: return float(r[k])
    except (ValueError, KeyError): return 0.0

def regime(r):
    if f(r, 'extinct_h') > 0: return 'мёртвая чашка'
    org = f(r, 'org')
    if org < 30: return 'на грани'
    photo, sapro, herb, pred = (f(r, k) for k in ('photo', 'sapro', 'herb', 'pred'))
    if photo / org > 0.85: return 'монокультура фототрофов'
    if sapro / org > 0.40: return 'грибное царство'
    if (herb + pred) / org > 0.40: return 'звериный мир'
    if pred >= 5 and herb >= 5 and sapro >= 5: return 'полная цепь'
    return 'обеднённая цепь'

# Флаг обязан требовать, чтобы механика была ВКЛЮЧЕНА. Первая версия этого не
# делала, и «половой мир» срабатывал там, где пол выключен галочкой: ген `sexual`
# без работающей механики ничего не стоит и свободно дрейфует вверх. То же самое
# с Красной Королевой при нулевом давлении паразитов.
FLAGS = {
    'многоклеточность': lambda r: f(r, 'maxSize') >= 15,
    'половой мир':      lambda r: r.get('sex') == '1' and f(r, 'sexShare') >= 0.50,
    'Красная Королева': lambda r: f(r, 'par') > 0 and f(r, 'keySd') >= 0.26 and f(r, 'inf') >= 0.50,
    'грибоядные':       lambda r: f(r, 'mycoShare') >= 0.40,
    'банк покоя':       lambda r: f(r, 'dorm') >= 0.40,
    'двудомность':      lambda r: f(r, 'dioecy') >= 0.35,
    # Появились вместе со свободными генами и видовой структурой. Порог «богатого
    # генома» взят не с потолка: медиана штатной точки на 12 000 ч — около 2, так
    # что 4 это вдвое выше обычного. «Много родов» — компонент графа скрещиваний
    # по 5 и более тел: одна такая компонента бывает всегда (это ниша), четыре
    # значат, что гены перестали течь между группами ВНУТРИ ниш.
    'богатый геном':    lambda r: 'mods' in r and f(r, 'mods') >= 4.0,
    'много родов':      lambda r: 'compBig' in r and f(r, 'compBig') >= 4,
}

for r in rows:
    r['_reg'] = regime(r)

KEYS = ('light', 'mut', 'decomp', 'par', 'dayNight', 'predation', 'sex')
boxes = defaultdict(list)
for r in rows:
    boxes[tuple(r[k] for k in KEYS)].append(r)

print("# Калибровка: режимы функционирования\n")
print(f"Прогонов: {len(rows)}, точек решётки: {len(boxes)}, "
      f"реплик на точку: {round(len(rows)/max(len(boxes),1),1)}\n")

print("## Сколько чего вышло\n")
cnt = defaultdict(int)
for r in rows: cnt[r['_reg']] += 1
for k, v in sorted(cnt.items(), key=lambda x: -x[1]):
    print(f"- **{k}** — {v} прогонов ({100*v/len(rows):.0f}%)")
print()

print("## Что двигает каждую ручку\n")
for key, name in (('light','свет'), ('mut','мутация'), ('decomp','разложение'), ('par','паразиты')):
    print(f"### {name}\n")
    vals = sorted({r[key] for r in rows}, key=float)
    print("| " + name + " | вымерло | тел (медиана) | max тело | полная цепь | " +
          " | ".join(FLAGS) + " |")
    print("|" + "---|" * (6 + len(FLAGS)))
    for v in vals:
        g = [r for r in rows if r[key] == v]
        alive = [r for r in g if f(r, 'extinct_h') == 0]
        ext = 100 * (len(g) - len(alive)) / len(g)
        pop = st.median([f(r, 'org') for r in alive]) if alive else 0
        mx = st.median([f(r, 'maxSize') for r in alive]) if alive else 0
        full = 100 * sum(1 for r in g if r['_reg'] == 'полная цепь') / len(g)
        fl = " | ".join(f"{100*sum(1 for r in alive if fn(r))/max(len(alive),1):.0f}%" for fn in FLAGS.values())
        print(f"| {v} | {ext:.0f}% | {pop:.0f} | {mx:.0f} | {full:.0f}% | {fl} |")
    print()

def purity(box_rows, pred):
    return sum(1 for r in box_rows if pred(r)) / len(box_rows)

print("## Пресеты — устойчивые миры\n")
print("Точки, где НИ ОДНА реплика не вымерла, цепь полная, и характер разный.\n")
stable = []
for box, g in boxes.items():
    if any(f(r, 'extinct_h') > 0 for r in g): continue
    if purity(g, lambda r: r['_reg'] in ('полная цепь', 'звериный мир', 'грибное царство')) < 0.99: continue
    stable.append((box, g))
stable.sort(key=lambda x: -st.median([f(r, 'org') for r in x[1]]))
def describe(box, g):
    d = dict(zip(KEYS, box))
    pop = st.median([f(r, 'org') for r in g])
    return (f"свет {d['light']}, мутация {d['mut']}, разложение {d['decomp']}, паразиты {d['par']}, "
            f"день/ночь {'да' if d['dayNight']=='1' else 'нет'}, хищники {'да' if d['predation']=='1' else 'нет'}, "
            f"пол {'да' if d['sex']=='1' else 'нет'} → тел {pop:.0f}, "
            f"ф/т/х/с {st.median([f(r,'photo') for r in g]):.0f}/{st.median([f(r,'herb') for r in g]):.0f}/"
            f"{st.median([f(r,'pred') for r in g]):.0f}/{st.median([f(r,'sapro') for r in g]):.0f}, "
            f"max тело {st.median([f(r,'maxSize') for r in g]):.0f}"
            + (f", генов {st.median([f(r,'mods') for r in g]):.1f}" if 'mods' in g[0] else "")
            + (f", родов {st.median([f(r,'compBig') for r in g]):.0f}" if 'compBig' in g[0] else ""))
for box, g in stable[:12]:
    print(f"- {describe(box, g)}")
print(f"\nВсего устойчивых точек: {len(stable)}\n")

print("## Пресеты — показательные механики\n")
print("Для каждого явления: точка, где оно проявляется чаще всего и мир при этом жив.\n")
for fname, fn in FLAGS.items():
    best = None
    for box, g in boxes.items():
        if any(f(r, 'extinct_h') > 0 for r in g): continue
        p = purity(g, fn)
        if p >= 0.66 and (best is None or p > best[0] or
                          (p == best[0] and st.median([f(r,'org') for r in g]) > st.median([f(r,'org') for r in best[2]]))):
            best = (p, box, g)
    if best:
        print(f"### {fname} (проявляется в {100*best[0]:.0f}% реплик)\n")
        print(f"- {describe(best[1], best[2])}\n")
    else:
        print(f"### {fname}\n\n- устойчивой точки не нашлось: явление либо редкое, либо только в гибнущих мирах\n")

if 'mods' in rows[0]:
    print("## Геном и видовая структура — то, чего в первой калибровке не было\n")
    print("Свободных генов на тело и компонент графа скрещиваний (компонента — не вид,\n"
          "а «род»: группа, внутри которой гены ещё текут; одна на нишу бывает всегда).\n")
    for key, name in (('light','свет'), ('mut','мутация'), ('decomp','разложение'), ('par','паразиты')):
        vals = sorted({r[key] for r in rows}, key=float)
        print(f"| {name} | генов на тело | у скольких тел | самый нагруженный | родов ≥5 тел | крупнейший род |")
        print("|" + "---|" * 6)
        for v in vals:
            alive = [r for r in rows if r[key] == v and f(r, 'extinct_h') == 0]
            if not alive: continue
            md = lambda k: st.median([f(r, k) for r in alive])
            print(f"| {v} | {md('mods'):.2f} | {100*md('modShare'):.0f}% | {md('modMax'):.0f} | "
                  f"{md('compBig'):.1f} | {md('compMax'):.0f} |")
        print()
    # На что чаще всего садятся свободные гены: если бы мишень была случайной,
    # каждый признак выходил бы в лидеры примерно поровну. Перекос — след отбора.
    tops = defaultdict(int)
    for r in rows:
        if f(r, 'extinct_h') == 0 and r.get('modTop', '-') not in ('-', ''): tops[r['modTop']] += 1
    if tops:
        tot = sum(tops.values())
        print("Самая частая мишень свободных генов в прогоне (доля прогонов):\n")
        print(", ".join(f"**{k}** {100*v/tot:.0f}%" for k, v in sorted(tops.items(), key=lambda x: -x[1])[:8]))
        print()

print("## Границы гибели\n")
for key, name in (('light','свет'), ('decomp','разложение')):
    vals = sorted({r[key] for r in rows}, key=float)
    line = []
    for v in vals:
        g = [r for r in rows if r[key] == v]
        line.append(f"{v}: {100*sum(1 for r in g if f(r,'extinct_h')>0)/len(g):.0f}%")
    print(f"- **{name}** — доля вымерших: " + ", ".join(line))
