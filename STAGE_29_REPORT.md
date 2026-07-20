# Stage 29 — Mobile keyboard and viewport UX

## Implemented

- Chat height follows `window.visualViewport` instead of relying only on `100dvh`.
- The message composer remains above the software keyboard in mobile browsers, installed PWA and Android WebView/APK wrappers.
- Viewport top offsets are handled for iOS zoom/keyboard behavior.
- Safe-area bottom padding remains active when the keyboard is closed and is reduced while the keyboard is open.
- Added `viewport-fit=cover` and `interactive-widget=resizes-content` viewport hints.
- Existing message auto-scroll and “jump to latest” behavior was intentionally left unchanged.
