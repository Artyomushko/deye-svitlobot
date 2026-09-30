# deye-svitlobot

Крихітний сервіс, який раз на хвилину питає [Deye Cloud](https://developer.deyecloud.com) про напругу
на вході інвертора з мережі. Якщо мережа є, він пінгує канал у [Світлоботі](https://svitlobot.in.ua).
Коли світло зникає, пінги припиняються, і Світлобот сам показує відключення.

Працює на безкоштовних тарифах Cloudflare Workers, AWS Lambda або Google Cloud Functions.

```
cron (1 хв) ──> Deye Cloud API ──> напруга мережі > GRID_MIN ? ──> GET api.svitlobot.in.ua/channelPing
```

## Що потрібно

1. **Доступ до Deye Cloud Developer API.** Зареєструйтесь на <https://developer.deyecloud.com>, створіть
   застосунок і отримайте `appId` та `appSecret`. Регіон за замовчуванням, `eu1`
   (`https://eu1-developer.deyecloud.com/v1.0`). Для іншого регіону змініть `DEYE_BASE_URL`.
2. **Ключ каналу Світлобота** (`channel_key`).
3. **SN інвертора** (не Wi-Fi-колектора, вони різні!). Це вкаже `npm run discover` (нижче).
4. Node.js 20+.

## Налаштування

| Змінна | Тип | Опис |
|---|---|---|
| `DEYE_APP_ID`, `DEYE_APP_SECRET` | секрет | дані застосунку з developer.deyecloud.com |
| `DEYE_EMAIL`, `DEYE_PASSWORD` | секрет | логін і пароль акаунта Deye Cloud |
| `DEYE_DEVICE_SN` | секрет | серійний номер **інвертора** |
| `SVITLOBOT_CHANNEL_KEY` | секрет | ключ каналу Світлобота |
| `DEYE_BASE_URL` | змінна | за замовчуванням `https://eu1-developer.deyecloud.com/v1.0` |
| `GRID_KEY` | змінна | показник напруги мережі, за замовчуванням `GridVoltageL1L2` |
| `GRID_MIN` | змінна | мережа є, якщо значення більше за це число (за замовчуванням `100`) |

Не використовуйте `ACVoltage*` і `LoadVoltage*`: це вихід інвертора, який тримається від батареї і без мережі.

### Як дізнатись SN і GRID_KEY

```bash
npm install
cp .dev.vars.example .dev.vars      # заповніть значення (файл у .gitignore)
npm run discover                    # виведе всі показники пристрою
```

Якщо `discover` каже `device not found`, перевірте SN: список пристроїв станції віддає
`POST /v1.0/station/device` (там є і `COLLECTOR`, і `INVERTER`; потрібен `INVERTER`).

Після цього перевірте, що обраний `GRID_KEY` справді падає до 0 під час відключення світла.

## Деплой

Секрети ніколи не кладіть у код чи в git. Нижче кожна платформа зберігає їх у власному сховищі.

### Cloudflare Workers (працює, але Deye може блокувати)

> **Увага.** Deye Cloud (CloudFront) блокує запити з вихідних IP Cloudflare: спершу епізодично, а з
> 30.09.2026 постійно. У відповідь приходить HTTP 403 із HTML-сторінкою `ACCESS IS BLOCKED`.
> Закріплення регіону (`[placement]`) не допомогло: блокується сама адреса, а не колокація.
> Якщо бачите таку помилку в логах, переходьте на GCP (нижче).

Безкоштовний тариф: 100 000 запитів на день, cron раз на хвилину це 1440.

```bash
npm install
npx wrangler login
# у дашборді один раз відкрийте Workers & Pages, щоб створився workers.dev-субдомен
# (без нього Cloudflare не дозволить зареєструвати cron)

for k in DEYE_APP_ID DEYE_APP_SECRET DEYE_EMAIL DEYE_PASSWORD DEYE_DEVICE_SN SVITLOBOT_CHANNEL_KEY; do
  npx wrangler secret put $k        # значення вводяться інтерактивно
done

npm run deploy                      # створить і KV-кеш токена (binding TOKENS)
npm run logs                        # живі логи
```

У логах має бути `GridVoltageL1L2=221.5V -> мережа є` і `svitlobot ping: 200`.
`[observability]` у `wrangler.toml` вмикає збереження логів (Dashboard → Workers & Pages → Observability),
а `npm run logs` показує лише живий потік.
`workers_dev = false` у `wrangler.toml`: публічна адреса воркеру не потрібна.

### AWS Lambda + EventBridge (не перевірено)

Безкоштовний рівень покриває ~43 000 викликів на місяць з великим запасом.

```bash
# 1. Пакет: адаптер + спільний код (залежностей немає)
zip -r function.zip aws src package.json

# 2. Роль для Lambda (один раз)
aws iam create-role --role-name deye-svitlobot \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name deye-svitlobot \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# 3. Функція; змінні середовища шифруються KMS at rest
aws lambda create-function --function-name deye-svitlobot \
  --runtime nodejs20.x --handler aws/lambda.handler --timeout 20 \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::<ACCOUNT_ID>:role/deye-svitlobot \
  --environment "Variables={DEYE_APP_ID=...,DEYE_APP_SECRET=...,DEYE_EMAIL=...,DEYE_PASSWORD=...,DEYE_DEVICE_SN=...,SVITLOBOT_CHANNEL_KEY=...}"

# 4. Запуск щохвилини
aws events put-rule --name deye-svitlobot-tick --schedule-expression 'rate(1 minute)'
aws lambda add-permission --function-name deye-svitlobot --statement-id tick \
  --action lambda:InvokeFunction --principal events.amazonaws.com \
  --source-arn arn:aws:events:<REGION>:<ACCOUNT_ID>:rule/deye-svitlobot-tick
aws events put-targets --rule deye-svitlobot-tick \
  --targets 'Id=1,Arn=arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:deye-svitlobot'
```

Значення змінних у команді потраплять в історію шелла. Щоб цього уникнути, задайте їх у консолі
або зберігайте в **Secrets Manager / SSM Parameter Store (SecureString)** і читайте в адаптері.
Токен Deye кешується лише в пам'яті теплого інстансу, тому на холодному старті вхід повторюється.

### Google Cloud Functions + Cloud Scheduler (перевірено, рекомендовано)

Безкоштовно: 2 млн викликів на місяць, 3 завдання Cloud Scheduler. Потрібен проєкт GCP з підключеним
білінг-акаунтом (без нього API не вмикаються, хоча списань у межах безкоштовного рівня немає).
Після `gcloud auth login` задайте проєкт: `gcloud config set project <ID>`.

```bash
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com pubsub.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com eventarc.googleapis.com

# Секрети в Secret Manager (значення читаються зі stdin, а не з аргументів)
for k in DEYE_APP_ID DEYE_APP_SECRET DEYE_EMAIL DEYE_PASSWORD DEYE_DEVICE_SN SVITLOBOT_CHANNEL_KEY; do
  read -rs -p "$k: " v; echo
  printf %s "$v" | gcloud secrets create $k --data-file=-
done
# Сервісному акаунту функції (за замовчуванням <НОМЕР_ПРОЄКТУ>-compute@developer.gserviceaccount.com)
# потрібна роль roles/secretmanager.secretAccessor на кожен із секретів:
for k in DEYE_APP_ID DEYE_APP_SECRET DEYE_EMAIL DEYE_PASSWORD DEYE_DEVICE_SN SVITLOBOT_CHANNEL_KEY; do
  gcloud secrets add-iam-policy-binding $k \
    --member="serviceAccount:<НОМЕР_ПРОЄКТУ>-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor
done

gcloud pubsub topics create deye-tick

gcloud functions deploy deye-svitlobot --gen2 --runtime=nodejs20 --region=europe-west1 \
  --source=. --entry-point=deyeSvitlobot --trigger-topic=deye-tick \
  --set-secrets=DEYE_APP_ID=DEYE_APP_ID:latest,DEYE_APP_SECRET=DEYE_APP_SECRET:latest,DEYE_EMAIL=DEYE_EMAIL:latest,DEYE_PASSWORD=DEYE_PASSWORD:latest,DEYE_DEVICE_SN=DEYE_DEVICE_SN:latest,SVITLOBOT_CHANNEL_KEY=SVITLOBOT_CHANNEL_KEY:latest

gcloud scheduler jobs create pubsub deye-tick --location=europe-west1 \
  --schedule='* * * * *' --topic=deye-tick --message-body=tick
```

`--source=.` враховує `.gitignore`, тому `.dev.vars` не потрапить у пакет.
Логи: `gcloud functions logs read deye-svitlobot --gen2 --region=europe-west1`.
Перший запуск Scheduler відбувається на початку наступної хвилини, тож у логах записи з'являться не одразу.
Точка входу описана в `gcp/function.mjs`, а `main` у `package.json` вказує на неї.

## Як це влаштовано

- `src/deye.js`: клієнт Deye Cloud (токен, `device/latest`); токен кешується в KV або пам'яті.
- `src/check.js`: спільна логіка перевірки мережі й пінгу; не залежить від платформи.
- `src/index.js`, `aws/lambda.mjs`, `gcp/function.mjs`: тонкі адаптери під кожну платформу.
- `scripts/discover.mjs`: локальна утиліта для пошуку SN і ключа показника.

## Обмеження

- Дані в Deye Cloud оновлюються приблизно раз на 1–5 хвилин, тому Світлобот бачить зміни із затримкою.
- Якщо Deye API не відповідає, пінг не надсилається (стан невідомий), і Світлобот вважає, що світла немає.
  Тимчасові збої Deye можуть давати хибні відключення.
- У Deye Cloud є ліміти запитів. Тому токен кешується, а не запитується щоразу.
- Deye може блокувати вихідні IP хмарних платформ (HTTP 403 від CloudFront). Помилка з'являється в
  логах із заголовками й тілом відповіді. Повторні спроби не додано навмисно, щоб не збільшувати навантаження.
  Якщо блокують і GCP, залишається VPS із постійним IP, який можна погодити з підтримкою Deye.

## Ліцензія

MIT
