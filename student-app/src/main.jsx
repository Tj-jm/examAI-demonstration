import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { store } from "./store";
import App from "./App";
import { initNativeBackButton } from "./native/backButton";
import { initNativeShell } from "./native/nativeShell";
import { applyTextSize } from "./utils/textSize";
import { captureRef } from "./utils/referralRef";

applyTextSize();
captureRef();
initNativeShell();
initNativeBackButton();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <HelmetProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </HelmetProvider>
    </Provider>
  </React.StrictMode>
);
