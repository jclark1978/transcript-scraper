# Spikes

Throwaway validation scripts used to de-risk an approach before investing in it.

**Expected lifetime:** short. Delete spikes once their finding has been captured (in `docs/PLAN.md`, `docs/DECISIONS.md`, or actual code).

## Current spikes

- **Phase 0 — ID stability + scroll-and-harvest validation** (not yet written). A DevTools console script that scrolls a real Teams transcript and verifies (a) `sub-entry-N` IDs are stable across virtualization, (b) `aria-setsize` is accurate, (c) a captured Map reaches 100% of `aria-setsize`. This is the go/no-go check before building the extension. See [../docs/PLAN.md](../docs/PLAN.md) §8 "What to Validate First."
