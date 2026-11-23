import { useLocalSearchParams } from "expo-router";
import ProfileEditSheet from "@/screens/settings/ProfileEditSheet";

/** The Personal info or Income & employment edit sheet. */
export default function ProfileEditRoute() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  return <ProfileEditSheet section={section === "income" ? "income" : "personal"} />;
}
