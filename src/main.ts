import "./styles.css";
import { createApp } from "./app";

const mountPoint = document.querySelector<HTMLDivElement>("#app");

if (!mountPoint) {
  throw new Error("Could not find the application mount point.");
}

createApp(mountPoint);
