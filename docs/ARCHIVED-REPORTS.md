# Archived reports

These superseded reports were archived outside this repository after byte verification against `37026c786497ca30e3cf00b02770c83b466754a4`. They are historical evidence, not current deployment instructions. Current gameplay receipts, original-stack isolation evidence and selected upgrade/ownership proofs remain in `docs/`.

Earlier entries in PROGRESS.md and historical JSON may name these original paths. Those references describe the files at the time of the recorded event. The inventory below preserves their identity.

| Original file | Bytes | SHA-256 |
| --- | ---: | --- |
| docs/TIDEBOUND-HOSTING.json | 117474 | `9291d459c94917d9f95954a75858ca8f1db38234b0167e221397a646efee9a20` |
| docs/TIDEBOUND-SETUP-RELEASE.json | 115580 | `921b568230b4588084669297909f79c8c391d4c69b579d366b1cf6c8b45ea8bb` |
| docs/TIDEBOUND-SESSION-RELEASE.json | 144952 | `6e4ccd65f2feefd30bcfb9f95cd3c4cfd3d9d91df58ee85cba64dd6599cfe019` |
| docs/TIDEBOUND-QA-RELEASE.json | 157189 | `c85a9bf953bbc2c72c6989dde8188de537e0d7cbed99d240226729018e56e38a` |
| docs/TIDEBOUND-PUBLIC-BROWSER.json | 10686 | `22334b15a74fb518e6a45dcc636cfa1ad904d09a9719246fd94e67748f1917cb` |
| docs/TIDEBOUND-ASSETS.json | 17443 | `1e99568e7eaa4f4324df376ae3a46a7f6f96a98d7974dd3e557c5c8b476c428c` |
| docs/TIDEBOUND-BASELINE.json | 2059 | `509941511e05c518e6496486e9d39a8e63d16b9dfdc7ddafd3d1ff0eab0b5e2d` |
| docs/PRIVY-RECOVERY-DEPLOYMENT.json | 20413 | `841a31542adf0332400ee4747f23226e1e4513bf1be48eb0860e6b7586ab24bc` |

With the existing Git history, recover any original report without changing the working tree:

```sh
git show 37026c786497ca30e3cf00b02770c83b466754a4:docs/TIDEBOUND-HOSTING.json > /tmp/TIDEBOUND-HOSTING.json
```

The previous architecture and threat-model documents were also retained in the local archive before their current descriptions were corrected. No original transaction evidence was rewritten.
