ПЛАН УСТРАНЕНИЯ БАГОВ АВТОРИЗАЦИИ И PASSKEY-РЕГИСТРАЦИИ

БАГ 1 (КРИТИЧЕСКИЙ): Дубликация тела компонента LoginScreen.tsx

Файл: src/components/LoginScreen.tsx (4878 строк)

Проблема: Компонент LoginScreen содержит ДВА полных набора обработчиков
(handleSeedRegister, handleSeedLogin, handleWebAuthnSubmit, handleTelegramOtpSubmit,
handleEmailSubmit, handleEmailOtpVerify, handleRealGoogleSignIn, handleCopyText,
showMethodInfo) и ДВА полных JSX-дерева (return).

Первый экземпляр: строки 68-2648
Второй экземпляр: строки 2660-4877

Закрывающая скобка первого компонента на строке 2648 повреждена:
  );
}    hapticImpact("medium");

После неё идёт код-сирота (строки 2649-2657), который ссылается на setGeneratedSeed
и другие состояния компонента, но находится ВНЕ области видимости функции.

Это приведёт к:
- SyntaxError при парсинге файла
- ReferenceError для setGeneratedSeed, hapticImpact, WORDS_POOL
- Дублированные объявления функций

Исправление:
1. Удалить строки 2649-4877 (весь дублированный код)
2. Исправить закрывающую скобку на строке 2648: заменить "); }    hapticImpact..." на "); }"
3. Убедиться, что handleCopyText (строка 1423) и showMethodInfo (строка 1430) остались
   внутри компонента (они на строках 1423-1509, до return на 1512)


БАГ 2 (КРИТИЧЕСКИЙ): Несовпадение seed при регистрации passkey через SettingsModal

Файл: src/components/SettingsModal.tsx, строка 428

Проблема: При добавлении passkey через Настройки, simulatedSeed вычисляется как:
  passkey security node ${userName.trim().toLowerCase()} ${userId}
где userId — это стабильный числовой tg_id.

Но при создании аккаунта через LoginScreen (регистрация passkey), simulatedSeed был:
  passkey security node ${webauthnName.trim().toLowerCase()} ${crypto.randomUUID()}

При логине через passkey (LoginScreen, строка 825) используется:
  deriveAesKeyFromSeed(passkeyData.seed)

Если passkey был добавлен через SettingsModal, то passkeyData.seed содержит userId,
а vault на сервере зашифрован ключом, производным от seed с randomUUID().
Эти ключи НЕ СОВПАДАЮТ, и расшифровка vault провалится с ошибкой
"Ошибка расшифровки ключей анклава".

Исправление:
В SettingsModal (строка 428) нужно генерировать seed так же, как в LoginScreen:
  const simulatedSeed = `passkey security node ${userName.trim().toLowerCase()} ${crypto.randomUUID()}`;
И сохранять этот seed в syndicate_passkey_credential (строка 444).


БАГ 3 (СРЕДНИЙ): Отсутствие local_vault при регистрации passkey через LoginScreen

Файл: src/components/LoginScreen.tsx, строки 751-756

Проблема: При регистрации passkey через LoginScreen, в IndexedDB сохраняется:
  { id, name, seed, credentialId }
БЕЗ поля local_vault.

При логине (строка 828) проверяется passkeyData.local_vault, и если его нет —
используется keysPayload.vault с сервера. Это работает, но:
- При офлайн-логине расшифровка с сервера невозможна
- SettingsModal сохраняет local_vault, а LoginScreen — нет (неконсистентность)

Исправление:
В handleWebAuthnSubmit (регистрация, строки 744-756) добавить экспорт приватных ключей
и сохранение local_vault, аналогично SettingsModal (строки 424-447):
  const rsaKey = await idbKeyval.get(`my_private_key_${stableId}`);
  const ecdsaKey = await idbKeyval.get(`my_sign_key_${stableId}`);
  let localVault = null;
  if (rsaKey && ecdsaKey) {
    const rsaPrivJwk = await crypto.subtle.exportKey('jwk', rsaKey);
    const ecdsaPrivJwk = await crypto.subtle.exportKey('jwk', ecdsaKey);
    localVault = await encryptVault(aesKey, rsaPrivJwk, ecdsaPrivJwk);
  }
  await idbKeyval.set('syndicate_passkey_credential', {
    id: stableId, name: webauthnName.trim(), seed: simulatedSeed,
    local_vault: localVault, credentialId: attResp.id
  });


БАГ 4 (СРЕДНИЙ): auth-custom не включает account_state в JWT

Файл: supabase/functions/auth-custom/index.ts, строки 54-57

Проблема: JWT, выпускаемый auth-custom, не содержит поля account_state.
Сравните с issueUserToken в provider-auth.ts (строка 55-68), где проверяется
account_state и блокируются заблокированные аккаунты.

auth-custom используется для:
- Seed-регистрации (handleSeedRegister)
- Email-регистрации (handleEmailOtpVerify)

При seed-логине используется auth-seed-challenge + auth-seed-verify (которые
проверяют account_state), но при РЕГИСТРАЦИИ через auth-custom проверка account_state
не выполняется. Это не критично для нового аккаунта (он всегда active), но
является неконсистентностью.

Исправление:
Добавить в auth-custom/index.ts проверку account_state перед выпуском JWT,
аналогично issueUserToken. Или перевести auth-custom на использование
issueUserToken из _shared/provider-auth.ts.


БАГ 5 (СРЕДНИЙ): auth-seed-verify не включает auth_provider в JWT claims

Файл: supabase/functions/auth-seed-verify/index.ts, строки 103-105

Проблема: JWT, выпускаемый auth-seed-verify, не содержит поля auth_provider.
Сравните с issueUserToken (provider-auth.ts, строка 63):
  auth_provider: provider

Это поле используется в verifySyndicateToken (provider-auth.ts, строка 212):
  const provider = typeof result.payload.auth_provider === 'string'
    ? result.payload.auth_provider : 'legacy'

При отсутствии auth_provider устанавливается 'legacy', что формально работает,
но теряется информация о провайдере аутентификации.

Исправление:
Добавить в JWT claims auth-seed-verify:
  auth_provider: 'seed'


БАГ 6 (НИЗКИЙ): webauthn-generate-registration-options — гонка данных при upsert challenge

Файл: supabase/functions/webauthn-generate-registration-options/index.ts, строки 76-81

Проблема: Используется upsert с id = reg_${stableId}. Если два запроса
на регистрацию с одинаковым stableId придут одновременно, второй перезапишет
challenge первого. Затем первый запрос провалит verify (challenge не совпадёт).

Для нового пользователя (register-passkey) stableId генерируется клиентом
с crypto.randomUUID(), поэтому коллизия маловероятна. Но для существующего
пользователя (add-passkey) stableId фиксирован, и возможна гонка.

Исправление:
Использовать уникальный ID для каждого challenge (например, crypto.randomUUID())
вместо reg_${stableId}. Или добавить проверку, что challenge ещё не потреблён.


БАГ 7 (НИЗКИЙ): auth-telegram-otp — нет fallback для устаревшего формата OTP

Файл: supabase/functions/auth-telegram-otp/index.ts, строки 72-81

Проблема: Если ALLOW_LEGACY_TELEGRAM_OTP не установлен в 'true', старые OTP
формата "код:timestamp" не принимаются. Это может сломать вход для пользователей,
чей бот не обновлён.

Исправление:
Установить ALLOW_LEGACY_TELEGRAM_OTP=true в переменных окружения Supabase,
или обновить telegram-bot.js до формата version 2.


БАГ 8 (НИЗКИЙ): PinScreen — нет проверки account_state при passkey-разблокировке

Файл: src/components/PinScreen.tsx, строки 38-91

Проблема: handleBiometricUnlock вызывает webauthn-verify-authentication,
который проверяет account_state на сервере. Но если сервер вернёт ошибку
"Аккаунт заблокирован", клиент просто покажет ошибку и НЕ разлогинит
пользователя. Пользователь останется в приложении с потенциально
заблокированным аккаунтом.

Исправление:
При получении ошибки блокировки от webauthn-verify-authentication,
вызывать принудительный logout (очистка токена, переход на экран логина).


ПРИОРИТЕТЫ ИСПРАВЛЕНИЙ:

1. КРИТИЧЕСКИЙ: Баг 1 — дубликация тела компонента (приложение не запустится)
2. КРИТИЧЕСКИЙ: Баг 2 — несовпадение seed в SettingsModal (passkey-логин сломан)
3. СРЕДНИЙ: Баг 3 — отсутствие local_vault в LoginScreen (офлайн-логин)
4. СРЕДНИЙ: Баг 4 — auth-custom без account_state в JWT
5. СРЕДНИЙ: Баг 5 — auth-seed-verify без auth_provider в JWT
6. НИЗКИЙ: Баг 6 — гонка данных в webauthn-generate-registration-options
7. НИЗКИЙ: Баг 7 — устаревший формат Telegram OTP
8. НИЗКИЙ: Баг 8 — PinScreen не обрабатывает блокировку аккаунта