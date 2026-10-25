import React from "react";
import ReactDOM from "react-dom/client";
import { Provider as ZellerProvider } from "@zeller-public/payments-sdk-react";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import App from "./App";
import "./till.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ZellerProvider
      vendorName="Roseberry Growers"
      vendorApplicationName="Roseberry Till"
      vendorApplicationVersion="1.0.0"
      vendorDeviceType="POS"
    >
      <App />
    </ZellerProvider>
  </React.StrictMode>
);

// Lets the till open with no internet once it has been loaded on the iPad.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
