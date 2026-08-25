# PVE Backup Validator

Автоматическое распределение CT/VM по типам бекапов в Proxmox VE кластере.

## Проблема

В Proxmox VE разные хранилища поддерживают разные режимы бекапов:

- **ZFS** (`local-zfs`) — поддерживает **snapshot** (мгновенный снимок, без остановки)
- **Dir/NFS** (`storage`, `NAS`) — **не** поддерживает snapshot → vzdump падает в **suspend** mode (полная копия rsync) → катастрофическая нагрузка на I/O → **hardware watchdog перезагружает сервер**

Одна VM с rootfs на dir-хранилище может уронить весь сервер при бекапе.

## Решение

Скрипт автоматически:

1. **Находит** все CT/VM кластера (pve + pve2)
2. **Определяет** тип хранилища rootfs и mount points
3. **Классифицирует** каждый гость:
   - rootfs на ZFS → **snapshot** mode
   - rootfs на dir/NFS → **stop** mode (остановка → бекап → запуск)
4. **Фиксит** mount points: ставит `backup=0` на non-ZFS mp (иначе snapshot тоже сломается)
5. **Ставит теги**: `backup-snapshot` / `backup-stop`
6. **Генерирует** `/etc/pve/jobs.cfg` с правильным расписанием
7. **Запускается каждый час** через cron

## Установка

```bash
# Клонировать
git clone https://github.com/Traineratwot/pve-backup-validator.git
cd pve-backup-validator

# Установить зависимости
bun install

# Установить cron (каждый час)
bun run install:cron

# Запустить вручную (для проверки)
bun run start
```

## Удаление cron

```bash
bun run uninstall:cron
```

## Как работает классификация

| Storage | Тип | Backup mode | Примечание |
|---------|-----|-------------|------------|
| `local-zfs` | zfspool | **snapshot** | Быстрый, безопасный |
| `storage` | dir | **stop** | Остановка контейнера на время бекапа |
| `NAS` | nfs | **stop** | Остановка контейнера на время бекапа |

### Mount points

Если CT на ZFS, но имеет mp на dir/NFS — автоматически ставится `backup=0` на этот mp. Иначе vzdump переключится в suspend mode и уронит сервер.

## Расписание (генерируется автоматически)

| Время | Mode | Кто |
|-------|------|-----|
| 3:00 | snapshot | Все CT+VM с rootfs на local-zfs |
| 6:30 | stop | CTs с rootfs на dir/NFS |

## Структура проекта

```
src/
  index.ts          — точка входа, orchestration
  classify.ts       — классификация CT/VM по storage type
  jobs.ts           — генерация /etc/pve/jobs.cfg
  ssh.ts            — SSH exec на pve/pve2
  tags.ts           — управление тегами
  config.ts         — константы
  schemas.ts        — valibot схемы
  cron-handler.ts   — обёртка для Bun.cron
  install.ts        — установка cron
  uninstall.ts      — удаление cron
```

## Добавление новой VM/CT

Просто создайте CT/VM как обычно. При следующем запуске скрипт автоматически определит storage type и распределит в нужный job.

## Логи

```bash
# Cron логи
journalctl -u cron --since "1 hour ago"

# Или проверить /etc/pve/jobs.cfg
cat /etc/pve/jobs.cfg
```

## Зависимости

- [Bun](https://bun.sh) — runtime
- [valibot](https://github.com/fabian-hiller/valibot) — валидация схем
- SSH доступ с pve → pve2 (для кластера)
