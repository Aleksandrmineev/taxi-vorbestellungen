# Lehrlinge: Redis-Kopie auf Vercel / копия данных в Redis

Fahrtenplan liest Daten aus Redis statt direkt aus Google Sheets.
Fahrtenplan читает данные из Redis, а не из Google Sheets. Таблица остаётся источником правды.

```
Sheet ──(GAS: lehrlinge_sync.gs)──▶ /api/lehrlinge/sync ──▶ Redis ◀── /api/lehrlinge/{schedule,student-plan}
Schreiben: Browser ▶ /api/lehrlinge/plan-save ▶ GAS (Sheet) ▶ dann Redis
```

Если Redis недоступен или пуст, клиент (`lehrlinge/driver-data.js`) сам переходит на прямой вызов GAS, как раньше.

## Einrichtung / Включение

1. **Vercel → Storage:** Redis (Free, Frankfurt), привязать к проекту. Код использует переменную окружения `REDIS_URL`.
2. **Vercel → Settings → Environment Variables:** `SYNC_SECRET` и `JWT_SECRET` (`openssl rand -hex 32`), затем Redeploy.
3. **GAS:** залить код (`clasp push`), затем в *Project Settings → Script Properties* добавить:
   - `SYNC_SECRET` — то же значение, что в Vercel. **Только сюда, в код не вписывать** (код уходит в GitHub).
   - `VERCEL_SYNC_URL` — необязательно; по умолчанию `https://taxi-murtal.vercel.app/api/lehrlinge/sync`
4. **GAS, один раз вручную:** запустить `installLehrlingeSyncTriggers` (ставит триггер раз в 5 минут и onEdit, сразу шлёт первый снапшот). Ответ `{ok:true,...}` = работает.
5. Новый деплой Web App (Deploy → Manage deployments → Edit → New version).

## Ausschalten / Выключение

- GAS: запустить `removeLehrlingeSyncTriggers` и удалить Script Property `SYNC_SECRET`. Снапшот в Redis живёт 30 минут, потом Vercel отвечает 503, и клиент работает через GAS как раньше.
- Vercel: *Deployments → предыдущий деплой → Instant Rollback* (или `git revert`, см. тег `pre-redis-sync`).

## Hinweise

- Функции Vercel лучше запускать рядом с Redis: *Settings → Functions → Function Region → Frankfurt (fra1)*. По умолчанию регион US (iad1), это добавляет ~100 мс на каждую команду Redis.

- Водители, вошедшие до этого обновления, автоматически получают JWT при первом открытии Fahrtenplan (обмен токена GAS), повторный вход не нужен.
- Free-план Redis без persistence: при сбросе базы данные восстанавливаются следующей синхронизацией (до 5 минут работает запасной путь через GAS).
