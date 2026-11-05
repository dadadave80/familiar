type Outcome = {
  status: unknown;
  receipts_outcome: {
    id: string;
    outcome: { executor_id: string; status: unknown };
  }[];
};
export function confirmedValue(
  outcome: Outcome,
  receiver: string,
  method: string,
): unknown {
  const failures = outcome.receipts_outcome
    .map((r) => r.outcome.status)
    .filter((s) => s && typeof s === "object" && "Failure" in s);
  let terminal = outcome.receipts_outcome.find(
    (r) => r.outcome.executor_id === receiver,
  );
  const seen = new Set<string>();
  while (
    terminal &&
    terminal.outcome.status &&
    typeof terminal.outcome.status === "object" &&
    "SuccessReceiptId" in terminal.outcome.status
  ) {
    if (seen.has(terminal.id)) throw new Error("ERR_ACTION_FAILED");
    seen.add(terminal.id);
    const next = terminal.outcome.status.SuccessReceiptId;
    terminal = outcome.receipts_outcome.find((r) => r.id === next);
  }
  const status = terminal?.outcome.status;
  if (
    !status ||
    typeof status !== "object" ||
    !("SuccessValue" in status) ||
    typeof status.SuccessValue !== "string"
  ) {
    const code = JSON.stringify(failures).match(/ERR_[A-Z_]+/)?.[0];
    throw new Error(code ?? "ERR_ACTION_FAILED");
  }
  let value: unknown;
  try {
    value =
      status &&
      typeof status === "object" &&
      "SuccessValue" in status &&
      typeof status.SuccessValue === "string" &&
      status.SuccessValue !== ""
        ? JSON.parse(atob(status.SuccessValue))
        : undefined;
  } catch {
    throw new Error("ERR_ACTION_FAILED");
  }
  const failed =
    outcome.status &&
    typeof outcome.status === "object" &&
    "Failure" in outcome.status;
  if (
    failed ||
    !terminal ||
    (status && typeof status === "object" && "Failure" in status) ||
    value === false ||
    (["act", "buy_pet", "claim"].includes(method) && value !== true) ||
    (method === "adopt" && typeof value !== "string")
  ) {
    const code = JSON.stringify(failures).match(/ERR_[A-Z_]+/)?.[0];
    throw new Error(code ?? "ERR_ACTION_FAILED");
  }
  return value;
}
