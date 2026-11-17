import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

parser=argparse.ArgumentParser()
parser.add_argument('action',choices=['plan','install','confirm','rollback'])
parser.add_argument('--config',required=True)
parser.add_argument('--hostname',required=True)
parser.add_argument('--port',type=int,required=True)
parser.add_argument('--state',required=True)
parser.add_argument('--service',default='cf-named-tunnel.service')
parser.add_argument('--cloudflared',default='/usr/local/bin/cloudflared')
args=parser.parse_args()
config=Path(args.config).resolve()
state=Path(args.state).resolve()
route=f'  - hostname: {args.hostname}\n    service: http://localhost:{args.port}\n'
if not all(c.isalnum() or c in '.-' for c in args.hostname):
    sys.exit('Неверное имя хоста')
if not 1024<=args.port<=65535:
    sys.exit('Неверный порт')
def digest(data):return hashlib.sha256(data).hexdigest()
def write_atomic(file,data):
    temp=file.with_name(file.name+'.evo-tmp')
    with open(temp,'wb') as stream:
        os.chmod(temp,0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp,file)
def validate(file):
    subprocess.run([args.cloudflared,'tunnel','--config',str(file),'ingress','validate'],check=True)
def timer_stop():
    subprocess.run(['systemctl','--user','stop','evolutioner-tunnel-rollback.timer'],check=False,capture_output=True)
def restart():subprocess.run(['systemctl','--user','restart',args.service],check=True)
before=config.read_bytes()
if args.action=='plan':
    validate(config)
    print(json.dumps({'config_sha256':digest(before),'already_present':route.encode() in before,'add_hostname':args.hostname,'add_port':args.port}))
elif args.action=='install':
    if state.exists():sys.exit('Журнал изменения уже существует; сначала подтвердить или откатить')
    text=before.decode()
    if args.hostname in text:sys.exit('Имя уже присутствует; конфигурация не изменена')
    marker='  - service: http_status:404'
    if text.count(marker)!=1:sys.exit('Не найден единственный завершающий маршрут')
    after=text.replace(marker,route+marker).encode()
    candidate=config.with_name(config.name+'.evo-candidate')
    write_atomic(candidate,after)
    try:validate(candidate)
    finally:candidate.unlink(missing_ok=True)
    state.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    backup=state.with_suffix('.backup')
    write_atomic(backup,before)
    record={'before':digest(before),'after':digest(after),'backup':str(backup),'route':route}
    write_atomic(state,json.dumps(record).encode())
    command=['systemd-run','--user','--unit=evolutioner-tunnel-rollback','--on-active=10m','/usr/bin/python3',str(Path(__file__).resolve()),'rollback','--config',str(config),'--hostname',args.hostname,'--port',str(args.port),'--state',str(state),'--service',args.service,'--cloudflared',args.cloudflared]
    subprocess.run(command,check=True)
    if digest(config.read_bytes())!=record['before']:
        timer_stop();sys.exit('Конфигурация изменилась между чтением и записью; установка отменена')
    write_atomic(config,after)
    restart()
    print('Добавлен один маршрут; автоматический откат через 10 минут')
elif args.action=='confirm':
    record=json.loads(state.read_text())
    if record['route'].encode() not in before:sys.exit('Новый маршрут исчез; подтверждение отменено')
    validate(config)
    timer_stop()
    record['confirmed']=True
    write_atomic(state,json.dumps(record).encode())
    print('Маршрут подтверждён; таймер отката снят')
else:
    record=json.loads(state.read_text())
    if record.get('confirmed'):sys.exit('Изменение уже подтверждено; автоматический откат не нужен')
    if digest(before)==record['after']:
        restored=Path(record['backup']).read_bytes()
    elif before.count(record['route'].encode())==1:
        # Соседняя сессия могла добавить маршрут: её изменения должны сохраниться.
        restored=before.replace(record['route'].encode(),b'',1)
    elif digest(before)==record['before']:
        timer_stop();sys.exit('Исходная конфигурация уже восстановлена')
    else:sys.exit('Маршрут изменён другим процессом; нужен ручной разбор')
    candidate=config.with_name(config.name+'.evo-candidate')
    write_atomic(candidate,restored)
    try:validate(candidate)
    finally:candidate.unlink(missing_ok=True)
    if config.read_bytes()!=before:sys.exit('Конфигурация меняется одновременно; откат отменён')
    write_atomic(config,restored);restart();timer_stop()
    print('Добавленный маршрут удалён; чужие изменения сохранены')
