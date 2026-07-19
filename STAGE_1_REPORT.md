# Этап 1 — GitHub Pages / Vite / PWA

## Исправлено

- Удалена жёсткая привязка PWA manifest к старому пути `/Sindikat-gm/`.
- `manifest.id`, `start_url` и `scope` теперь используют относительные пути и подходят для project pages GitHub Pages.
- Внешние иконки Flaticon заменены локальными PNG 192×192 и 512×512.
- Добавлена отдельная maskable-иконка.
- Удалены внешние Unsplash screenshots из manifest, которые делали установку PWA зависимой от стороннего CDN.
- Apple touch icon переведён на локальный файл.
- Удалён дублирующий глобальный обработчик `beforeinstallprompt` из `src/main.tsx`; управление осталось в React-компоненте.
- Добавлено явное логирование ошибки регистрации service worker.
- Workbox теперь очищает устаревшие кэши и активирует обновлённый service worker без сохранения старого кэша.

## Проверка

Статическая проверка изменённых файлов выполнена. Полный `npm run lint` и `npm run build` не были завершены, потому что зависимости отсутствуют в архиве, а `npm install` в текущем окружении дважды превысил лимит выполнения. Ошибки TypeScript, полученные при проверке, относятся к отсутствующим npm-пакетам, а не к изменённым исходникам.

## Изменённые файлы

- `vite.config.ts`
- `index.html`
- `src/main.tsx`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-maskable-512.png`
