import { EmptyState, ErrorState } from "@/ui/State";
import { errorText } from "@/api/client";

/** The whole-screen state when nothing is connected (the theme's sleepy art), or nothing loaded. */
export function HomeEmptyState({ kind, error, onAction }: { kind: "empty" | "failed"; error?: unknown; onAction: () => void }) {
  return kind === "failed" ? (
    <ErrorState title="Couldn't load your accounts" body={`Your accounts are safe. ${errorText(error)}`} onRetry={onAction} />
  ) : (
    <EmptyState
      icon="wallet.bifold"
      title="Connect your first account"
      body="Link a bank, card or brokerage to see your net worth, spending and next steps here."
      action={{ title: "Connect a bank", onPress: onAction }}
    />
  );
}
