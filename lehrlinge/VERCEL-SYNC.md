# Lehrlinge: Redis-Kopie auf Vercel / копия данных в Redis

Fahrtenplan liest Daten aus Redis statt direkt aus Google Sheets.
Fahrtenplan читает данные из Redis, а не из Google Sheets. Таблица остаётся источником правды.

```
Sheet ──(GAS: lehrlinge_sync.gs)──▶ /api/lehrlinge/sync ──▶ Redis ◀── /api/lehrlinge/{schedule,student-plan}
Schreiben: Browser ▶ /api/lehrlinge/plan-save ▶ Redis + Outbox (sofort, ~0,2 s) ▶ im Hintergrund GAS ▶ Sheet
```

Если Redis недоступен или пуст, клиент (`lehrlinge/driver-data.js`) сам переходит на прямой вызов GAS, как раньше.

## Запись: очередь (outbox) / Schreiben

`plan-save` отвечает водителю сразу: изменение попадает в Redis и в очередь `lehrlinge:outbox`, затем в фоне
(`waitUntil`) уходит в таблицу через GAS. Таблица остаётся источником правды, но с задержкой в секунды.

- Сбой сети/GAS: запись остаётся в очереди и повторяется (после каждого сохранения и при каждой синхронизации, т. е. ≤ 5 мин). После 8 неудач или осмысленного отказа GAS запись уходит в `lehrlinge:outbox:dead` (Redis), в ответе `sync` виден счётчик `outbox.dead`, GAS пишет предупреждение в лог.
- Пока запись в очереди или моложе 2 минут, снапшот из таблицы её не перезаписывает (нет «отката» на экране).
- Если сам Redis недоступен, клиент пишет напрямую в GAS (медленно, но надёжно).
- Один слив за раз (блокировка `lehrlinge:outbox:lock`), записи одного ключа уходят по порядку.

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

## Gemeinsamer Zugang für Lehrlinge (Testphase) / Общий пробный доступ

Портал учеников (`taxi-lehrlinge-portal`) имеет кнопку «Ohne Registrierung starten»: общий логин `lehrlinge` + пароль, затем выбор Lehrling и то же окно редактирования.

- **Включение:** в Vercel env задать `SHARED_LOGIN_PASSWORD` (пароль, например почтовый индекс Пёльса) и сделать Redeploy. **Сначала обновите GAS** (`clasp push`): без него запись общего доступа не дойдёт до таблицы.
- **Выключение мгновенно:** удалить `SHARED_LOGIN_PASSWORD` в Vercel и сделать Redeploy: все выданные токены перестают работать, кнопка отвечает «nicht verfügbar».
- **Что разрешено токену `shared`:** `students` (только id и имя), `student-plan` (без домашнего адреса), `plan-save`. Полное расписание, телефоны и адреса недоступны.
- **Сервер сам проверяет сроки:** Hin до 03:00, Zurück до 12:00 (Europe/Vienna) в день поездки, прошедшие дни закрыты.
- **Защита пароля:** сервер сравнивает пароль, не более 10 попыток за 10 минут с одного IP (ответ 429).
- **Журнал:** правки помечаются `portal:lehrlinge` (видно водителям в «Geändert von»).
- Токен живёт 30 дней. Запасного пути через GAS у общего доступа нет: если Redis недоступен, портал покажет «Server nicht erreichbar».
