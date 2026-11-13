# Saved-progress compatibility

This directory contains the frozen bounded return validator used by historical saved returns. It is not another playable game. The current game and rules live in `../expedition/`.

Keep deployed content/rules identifiers, native signed requests, storage namespaces, claim hashes and maker provenance unchanged. Reinterpreting these values as current rules would change the meaning of earned progress. The current client does not construct new returns with this validator; it verifies existing records and preserves the original request policy.
