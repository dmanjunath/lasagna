import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { profileApi } from "@/api/profile";
import { DetailRows, ScreenLead } from "@/components/profile/SettingsParts";
import { useAmountsHidden } from "@/lib/hide-amounts";
import { pushInTab } from "@/lib/navigation";
import { incomeRows, personalRows, SECTION_TITLE, type ProfileSection } from "@/lib/profile";
import { ScreenScroll } from "@/ui/ScreenScroll";
import { ErrorState } from "@/ui/State";
import { DEMO_BUILD } from "../ProfileScreen";

/** Personal info, or Income & employment: the stored figures, and Edit, which opens the sheet. */
export default function ProfileInfoScreen({ section }: { section: ProfileSection }) {
  useAmountsHidden(); // the income row
  const profile = useQuery({ queryKey: ["financial-profile"], queryFn: profileApi.get });
  const p = profile.data?.financialProfile ?? null;
  const rows = section === "personal" ? personalRows(p) : incomeRows(p);
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    try {
      await profile.refetch();
    } finally {
      setPulling(false);
    }
  };
  const failed = profile.isError && !profile.data;
  return (
    <>
      {!DEMO_BUILD && !failed ? (
        // The chrome contract: a detail screen's main verb.
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel={`Edit ${SECTION_TITLE[section].toLowerCase()}`} disabled={profile.isPending} onPress={() => pushInTab(`/profile-edit?section=${section}`)}>
            Edit
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}
      <ScreenScroll title={SECTION_TITLE[section]} refreshing={pulling} onRefresh={() => void onPull()}>
        <ScreenLead>Powers your tax, retirement, and cash-flow insights.</ScreenLead>
        {failed ? (
          <ErrorState compact title="Couldn't load your profile" error={profile.error} onRetry={() => void profile.refetch()} />
        ) : (
          <DetailRows rows={rows} loading={profile.isPending} />
        )}
      </ScreenScroll>
    </>
  );
}
