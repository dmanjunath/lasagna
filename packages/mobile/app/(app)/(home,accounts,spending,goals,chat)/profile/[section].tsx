import { useLocalSearchParams } from "expo-router";
import ProfileScreen from "@/screens/ProfileScreen";
import BillingScreen from "@/screens/settings/BillingScreen";
import HouseholdScreen from "@/screens/settings/HouseholdScreen";
import PreferencesScreen from "@/screens/settings/PreferencesScreen";
import ProfileInfoScreen from "@/screens/settings/ProfileInfoScreen";
import SecurityScreen from "@/screens/settings/SecurityScreen";

/** One Settings section (/profile#household lands here), pushed from the list. */
export default function ProfileSectionRoute() {
  const { section } = useLocalSearchParams<{ section: string }>();
  if (section === "personal" || section === "income") return <ProfileInfoScreen section={section} />;
  if (section === "household") return <HouseholdScreen />;
  if (section === "billing") return <BillingScreen />;
  if (section === "security") return <SecurityScreen />;
  if (section === "preferences") return <PreferencesScreen />;
  return <ProfileScreen />;
}
