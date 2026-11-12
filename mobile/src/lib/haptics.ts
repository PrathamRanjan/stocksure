import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/** Haptics are a confirmation, never the only signal; they do nothing on web. */
const on = Platform.OS === "ios" || Platform.OS === "android";
export const tap = () => on && void Haptics.selectionAsync().catch(() => {});
export const success = () => on && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
export const warn = () => on && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
export const thud = () => on && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
