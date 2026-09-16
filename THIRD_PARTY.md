# Использованные компоненты

- Magic UI NumberTicker: https://github.com/magicuidesign/magicui — MIT.
  Источник `apps/www/registry/magicui/number-ticker.tsx`; локальные изменения:
  путь импорта утилиты и форматирование чисел ru-RU.
- React Bits FadeContent: https://github.com/DavidHDev/react-bits — MIT + Commons Clause.
  Получен через https://github.com/ceorkm/reactbits-mcp-server, инструмент `get_component`.
  Источник `src/ts-tailwind/Animations/FadeContent/FadeContent.tsx`.
  Используется внутри приложения, не продаётся как отдельный компонент.
- React Bits MCP Server: https://github.com/ceorkm/reactbits-mcp-server — MIT.
  Установлен локально; проверен через `node tools/reactbits-client.mjs`.
- Manrope: https://github.com/sharanda/manrope — SIL Open Font License.
  Файлы шрифта поставляются локально через @fontsource-variable/manrope.

Лицензии исходных компонентов сохранены в `frontend/react/vendor`, шрифта — в
`frontend/fonts/LICENSE`. Прочие зависимости перечислены и закреплены в package-lock.json.

Запрошенные скиллы уже установлены на компьютере: Humanizer, design-taste-frontend
(TasteSkill), Web Design Guidelines, Awesome Design, Image to Code, Playwright,
emil-design-eng, Magic UI. Копии этих скиллов в приложение не встраиваются.
