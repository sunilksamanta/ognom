# Ognom - project instructions

## Writing style (hard rule)

- Never use em dashes (U+2014) or en dashes (U+2013) anywhere: not in
  code, comments, UI strings, docs, commit messages, or chat replies. Use a
  plain hyphen "-" (with spaces around it when used as a clause break), a
  comma, or a colon instead.
- When editing existing text that contains an em dash, replace it with a
  plain "-".

## Design system

- The visual design lives in `../ognom-design-system` (theme-kit.css,
  ognom-app.css, console-reference.html, logo-sheet.html, logo/).
- The app's `src/styles/theme-kit.css` and `src/styles/ognom-app.css` are the
  in-repo copies of that contract. Components read only the tokens
  (`--bg`, `--panel`, `--accent`, `--row`, ...) - never literal colours.
- Two attributes on `<html>` drive everything: `data-theme` and `data-density`.
- The mark is `<OgnomMark />` (`src/components/brand/OgnomMark.tsx`) and always
  paints with `currentColor`; in-app it sits on `var(--accent)`.

## Product scope

- No AI / Studio / "Terminator" features. Do not reintroduce OpenAI or any
  LLM provider settings.
- Connections can be flagged `production`; a production workspace opens
  read-only and the user must switch to edit mode explicitly.
- Destructive multi-document deletes offer an optional JSON backup first;
  dropping a collection requires typing its name and offers an optional
  export.
