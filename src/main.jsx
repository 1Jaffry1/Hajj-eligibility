import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

// this line is REQUIRED
import "./index.css";

createRoot(document.getElementById("root")).render(<App />);
