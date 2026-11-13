# Archived reports

Historical release, account and deployment reports are preserved outside this checkout with SHA-256 inventories. The working tree keeps only `FAMILIAR-GAMEPLAY.json` (offline regression evidence) and `TESTNET-DEPLOYMENT.json` (original-stack isolation guards).

The eight earlier hosting/setup reports are available in Git at `37026c786497ca30e3cf00b02770c83b466754a4`. The ten remaining historical JSONs and full previous JUDGES/PROGRESS documents are available at `c3aa22b5094e0772b4a4bb793f1bad8bdb51321a`.

Recover an original without changing the checkout, substituting its commit and path:

```sh
git show c3aa22b5094e0772b4a4bb793f1bad8bdb51321a:docs/FAMILIAR-RELEASE.json > /tmp/FAMILIAR-RELEASE.json
```

Archived reports are dated evidence, not instructions to repeat completed transactions. No original proof was rewritten. These Git references depend on retaining the existing history; a history-free export would need the separate archive inventories.
