## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one: Closes #123 -->

## How to test

<!-- Steps a reviewer can follow. -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass
- [ ] `cargo test` passes (for backend changes)
- [ ] New backend commands have a matching case in `src/dev/mockTauri.ts`
- [ ] Writes respect read-only / production workspaces
- [ ] Design tokens only, no literal colours
- [ ] No em dashes in code, UI text or docs
- [ ] Screenshot attached for UI changes
