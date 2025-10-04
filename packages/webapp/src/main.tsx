import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import TaskPage from './pages/TaskPage';
import StartPage from './pages/StartPage';

const router = createBrowserRouter([
  { path: '/', element: <StartPage /> },
  { path: '/start', element: <StartPage /> },
  { path: '/tasks/:taskId', element: <TaskPage /> },
]);

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
