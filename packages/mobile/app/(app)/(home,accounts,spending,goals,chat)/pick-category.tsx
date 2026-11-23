import { router } from "expo-router";
import { CategoryPickerPage } from "@/components/transactions/CategoryList";
import { heldCategoryRequest } from "@/lib/txn-sheets";
import { EmptyState } from "@/ui/State";

/** Picks one category for a row's or a selection's recategorize. */
export default function PickCategory() {
  const req = heldCategoryRequest();
  if (!req) return <EmptyState title="Nothing to categorize" action={{ title: "Close", onPress: () => router.back() }} />;
  return (
    <CategoryPickerPage
      title={req.title}
      value={req.value}
      onCancel={() => router.back()}
      onPick={(id) => {
        router.back();
        req.onPick(id);
      }}
    />
  );
}
