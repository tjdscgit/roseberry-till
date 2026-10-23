import React from "react";
import ReactDOM from "react-dom/client";
import { Provider as ZellerProvider } from "@zeller-public/payments-sdk-react";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ZellerProvider
      vendorName="Roseberry Growers"
      vendorApplicationName="Roseberry Till Test"
      vendorApplicationVersion="0.1.0"
      vendorDeviceType="POS"
    >
      <App />
    </ZellerProvider>
  </React.StrictMode>
);
