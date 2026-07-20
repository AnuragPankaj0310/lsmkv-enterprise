import { createBrowserRouter } from "react-router-dom";

import DashboardLayout from "./layouts/DashboardLayout";

import Dashboard   from "./pages/Dashboard";
import Cluster     from "./pages/Cluster";
import HashRing    from "./pages/HashRing";
import Storage     from "./pages/Storage";
import Replication from "./pages/Replication";
import Metrics     from "./pages/Metrics";
import Snapshots   from "./pages/Snapshots";
import Logs        from "./pages/Logs";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <DashboardLayout />,
    children: [
      { index: true,          element: <Dashboard /> },
      { path: "cluster",      element: <Cluster /> },
      { path: "ring",         element: <HashRing /> },
      { path: "storage",      element: <Storage /> },
      { path: "replication",  element: <Replication /> },
      { path: "metrics",      element: <Metrics /> },
      { path: "logs",         element: <Logs /> },
      { path: "snapshots",    element: <Snapshots /> },
    ],
  },
]);