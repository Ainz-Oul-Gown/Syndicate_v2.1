# Stage 26 — Startup UX

## Implemented
- Added a dedicated startup screen with clear initialization stages.
- Added delayed retry action for slow startup.
- Added explicit offline startup state with automatic retry when connectivity returns.
- Replaced technical initialization errors with user-facing messages.
- Prevented the main interface from appearing before key checks and device registration complete.
- Added safe-area, standalone PWA and reduced-motion friendly styling.

## Startup stages
1. Проверяем сессию
2. Загружаем ключи
3. Подключаемся

## Verification
- `npm ci --ignore-scripts`
- `npm run build`
- Vite production build completed successfully.
- PWA service worker and precache regenerated.
