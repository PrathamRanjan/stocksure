import { Platform } from "react-native";

/** A file chosen from the camera, photo library or Files. On web the picker also hands back a real File. */
export interface Picked {
  uri: string;
  name: string;
  type: string;
  file?: File;
}

/** Append a picked file to multipart form data in the shape each platform's fetch understands. */
export async function appendFile(fd: FormData, field: string, f: Picked) {
  if (Platform.OS === "web") {
    const blob = f.file ?? (await (await fetch(f.uri)).blob());
    fd.append(field, blob, f.name);
    return;
  }
  // React Native's FormData takes { uri, name, type } and streams the file itself.
  fd.append(field, { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
}
