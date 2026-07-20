import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import "./index.css";
import { router } from "./router";
import { ClusterProvider } from "./context/ClusterContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClusterProvider>
      <RouterProvider router={router} />
    </ClusterProvider>
  </React.StrictMode>
);
