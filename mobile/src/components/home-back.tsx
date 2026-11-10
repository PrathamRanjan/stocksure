import { useCanGoBack, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { Pressable } from "react-native";
import { useTheme } from "./theme";

/** Header button for a screen opened straight from a link or notification, with nothing to go back to. */
export function useHomeBack() {
  const canGoBack = useCanGoBack();
  const router = useRouter();
  const { p } = useTheme();
  if (canGoBack) return undefined;
  return () => (
    <Pressable accessibilityRole="button" accessibilityLabel="Orders" onPress={() => router.replace("/")} hitSlop={12} style={{ minWidth: 44, minHeight: 44, justifyContent: "center" }}>
      <ChevronLeft size={26} color={p.ink} />
    </Pressable>
  );
}
