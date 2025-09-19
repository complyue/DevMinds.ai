import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import TaskPage from "./pages/TaskPage";
import StartPage from "./pages/StartPage";
import SettingsProviders from "./pages/SettingsProviders";

const router = createBrowserRouter([
  { path: "/", element: <StartPage /> },
  { path: "/start", element: <StartPage /> },
  { path: "/tasks/:taskId", element: <TaskPage /> },
  { path: "/settings/providers", element: <SettingsProviders /> },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
