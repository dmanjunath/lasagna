import { EmptyState, ErrorState } from "@/ui/State";

/** The whole-screen state when nothing is connected (the theme's sleepy art), or nothing loaded. */
export function HomeEmptyState({ kind, onAction }: { kind: "empty" | "failed"; onAction: () => void }) {
  return kind === "failed" ? (
    <ErrorState title="Couldn't load your accounts" body="Your accounts are safe. This is on our side, so trying again usually works." onRetry={onAction} />
  ) : (
    <EmptyState
      icon="wallet.bifold"
      title="Connect your first account"
      body="Link a bank, card or brokerage to see your net worth, spending and next steps here."
      action={{ title: "Connect a bank", onPress: onAction }}
    />
  );
}
