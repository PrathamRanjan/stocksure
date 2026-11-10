import { Archivo_700Bold, Archivo_800ExtraBold } from "@expo-google-fonts/archivo";
import { SourceSans3_400Regular, SourceSans3_600SemiBold, SourceSans3_700Bold } from "@expo-google-fonts/source-sans-3";
import { useFonts } from "expo-font";
import { SplashScreen } from "expo-router";
import Stack from "expo-router/stack";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "@/components/theme";
import { ToastProvider } from "@/components/toast";
import { loadServer } from "@/lib/api";
import { fonts } from "@/lib/theme";
import { SessionProvider } from "@/lib/session";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Nav() {
  const { p, scheme } = useTheme();
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(p.paper).catch(() => {});
  }, [p.paper]);
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: p.paper },
          headerStyle: { backgroundColor: p.paper },
          headerTintColor: p.ink,
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: fonts.heading, fontSize: 17, color: p.ink },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="order/[id]/index" options={{ title: "Order" }} />
        <Stack.Screen name="order/[id]/receive" options={{ title: "Count it in", presentation: "card" }} />
      </Stack>
    </>
  );
}

export default function Root() {
  const [ready, setReady] = useState(false);
  const [loaded, err] = useFonts({
    "ArchivoExpanded-ExtraBold": require("../../assets/fonts/ArchivoExpanded-ExtraBold.ttf"),
    "ArchivoExpanded-Bold": require("../../assets/fonts/ArchivoExpanded-Bold.ttf"),
    Archivo_700Bold,
    Archivo_800ExtraBold,
    SourceSans3_400Regular,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
  });
  useEffect(() => {
    loadServer().finally(() => setReady(true));
  }, []);
  const go = ready && (loaded || !!err);
  useEffect(() => {
    if (go) SplashScreen.hideAsync().catch(() => {});
  }, [go]);
  if (!go) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ToastProvider>
            <Nav />
          </ToastProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
