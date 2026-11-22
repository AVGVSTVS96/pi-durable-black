import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { bootstrapToken } from "./auth.ts";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Application root is missing");

bootstrapToken();
createRoot(root).render(<App />);
