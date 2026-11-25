import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { saveErrorText } from "@/api/client";
import { profileApi } from "@/api/profile";
import { ChoicePage, DateRow, InputRow, ToggleRow } from "@/components/accounts/FormFields";
import {
  decimalNumber,
  EMPLOYMENT_OPTIONS,
  FILING_STATUS_OPTIONS,
  formErrors,
  formFrom,
  labelOf,
  latestAdultBirthDate,
  RISK_TOLERANCE_OPTIONS,
  SECTION_TITLE,
  updatesFor,
  wholeNumber,
  type FinancialProfile,
  type ProfileForm,
  type ProfileSection,
} from "@/lib/profile";
import { useTheme } from "@/theme";
import { committed } from "@/ui/feedback";
import { Divider, formStyles, Group, NavRow, SectionHeader, SheetBar } from "@/ui/Form";
import { useDiscardGuard } from "@/ui/sheet";
import { ErrorState } from "@/ui/State";

/** Personal info or Income & employment, edited in a sheet (the web's edit panels). */
export default function ProfileEditSheet({ section }: { section: ProfileSection }) {
  const profile = useQuery({ queryKey: ["financial-profile"], queryFn: profileApi.get });
  if (profile.isPending) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (profile.isError && !profile.data) {
    return (
      <>
        <SheetBar title={SECTION_TITLE[section]} left={{ title: "Cancel", onPress: () => router.back() }} />
        <ErrorState title="Couldn't load your profile" error={profile.error} onRetry={() => void profile.refetch()} />
      </>
    );
  }
  return <Editor section={section} stored={profile.data.financialProfile} />;
}

type Page = "form" | "filing" | "risk" | "employment";

function Editor({ section, stored }: { section: ProfileSection; stored: FinancialProfile | null }) {
  const t = useTheme();
  const qc = useQueryClient();
  const [initial] = useState(() => formFrom(stored));
  const [form, setForm] = useState<ProfileForm>(initial);
  const set = (patch: Partial<ProfileForm>) => setForm((f) => ({ ...f, ...patch }));
  const [page, setPage] = useState<Page>("form");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const leave = useDiscardGuard(dirty && !saving);
  const { errors, blocking } = formErrors(section, form);
  const maxDob = latestAdultBirthDate();

  const save = async () => {
    if (!dirty) return router.back();
    setSaving(true);
    setError(null);
    try {
      await profileApi.update(updatesFor(section, form));
    } catch (e) {
      setError(saveErrorText(e, "Couldn't save your changes. Check them and try again."));
      setSaving(false);
      return;
    }
    // The figures feed the journey, the retirement plan and the goals.
    for (const key of [["financial-profile"], ["household-profiles"], ["financial-path"]]) void qc.invalidateQueries({ queryKey: key });
    leave();
    committed("Changes saved");
  };

  const choice = (title: string, options: typeof FILING_STATUS_OPTIONS, value: string, apply: (v: string) => void) => (
    <ChoicePage
      title={title}
      value={value}
      options={options}
      onCancel={() => setPage("form")}
      onPick={(v) => {
        apply(v);
        setPage("form");
      }}
    />
  );
  if (page === "filing") return choice("Filing status", FILING_STATUS_OPTIONS, form.filingStatus, (filingStatus) => set({ filingStatus }));
  if (page === "risk") return choice("Risk tolerance", RISK_TOLERANCE_OPTIONS, form.riskTolerance, (riskTolerance) => set({ riskTolerance }));
  if (page === "employment") return choice("Employment type", EMPLOYMENT_OPTIONS, form.employmentType, (employmentType) => set({ employmentType }));

  const problems = Object.values(errors);
  return (
    <>
      <SheetBar
        title={SECTION_TITLE[section]}
        left={{ title: "Cancel", onPress: () => router.back(), disabled: saving }}
        right={{ title: "Save", strong: true, busy: saving, disabled: blocking, onPress: () => void save() }}
      />
      <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={formStyles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        {section === "personal" ? (
          <>
            <View style={formStyles.section}>
              <SectionHeader>About you</SectionHeader>
              <Group>
                <DateRow label="Date of birth" value={form.dateOfBirth} max={maxDob} start={maxDob} onChange={(dateOfBirth) => set({ dateOfBirth })} />
                <Divider />
                <InputRow
                  label="State"
                  value={form.stateOfResidence}
                  onChange={(v) => set({ stateOfResidence: v.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() })}
                  placeholder="CA"
                  autoCapitalize="characters"
                />
                <Divider />
                <NavRow label="Filing status" value={labelOf(FILING_STATUS_OPTIONS, form.filingStatus)} onPress={() => setPage("filing")} />
                <Divider />
                <InputRow label="Dependents" value={form.dependentCount} onChange={(v) => set({ dependentCount: wholeNumber(v).slice(0, 2) })} placeholder="0" keyboardType="number-pad" />
              </Group>
            </View>
            <View style={formStyles.section}>
              <SectionHeader>Plans</SectionHeader>
              <Group>
                <InputRow label="Retirement age" value={form.retirementAge} onChange={(v) => set({ retirementAge: wholeNumber(v).slice(0, 3) })} placeholder="65" keyboardType="number-pad" />
                <Divider />
                <NavRow label="Risk tolerance" value={labelOf(RISK_TOLERANCE_OPTIONS, form.riskTolerance)} onPress={() => setPage("risk")} />
              </Group>
            </View>
            <View style={formStyles.section}>
              <SectionHeader>Health and work</SectionHeader>
              <Group>
                <ToggleRow label="High-deductible health plan" detail="You're enrolled in an HDHP." value={form.hasHDHP} onChange={(hasHDHP) => set({ hasHDHP })} />
                <Divider />
                <ToggleRow label="Public service" detail="You work in public service (PSLF eligible)." value={form.isPSLFEligible} onChange={(isPSLFEligible) => set({ isPSLFEligible })} />
              </Group>
            </View>
          </>
        ) : (
          <View style={formStyles.section}>
            <Group>
              <NavRow label="Employment type" value={labelOf(EMPLOYMENT_OPTIONS, form.employmentType)} onPress={() => setPage("employment")} />
              <Divider />
              <InputRow label="Annual gross income" value={form.annualIncome} onChange={(v) => set({ annualIncome: wholeNumber(v).slice(0, 10) })} placeholder="72,000" keyboardType="number-pad" money />
              <Divider />
              <InputRow label="Employer match (%)" value={form.employerMatchPercent} onChange={(v) => set({ employerMatchPercent: decimalNumber(v).slice(0, 5) })} placeholder="4" keyboardType="decimal-pad" />
            </Group>
          </View>
        )}
        {problems.map((p) => (
          <Text key={p} style={[formStyles.error, { color: t.negative }]}>
            {p}
          </Text>
        ))}
        {error ? <Text style={[formStyles.error, { color: t.negative }]}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}
