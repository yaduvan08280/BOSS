import { createBrowserRouter, Navigate } from 'react-router';
import { ALL_ITEMS } from '@/layout/nav';
import { AccountPage } from '@/modules/account/AccountPage';
import { LoginPage } from '@/modules/auth/LoginPage';
import { UiKitPage } from '@/modules/dev/UiKitPage';
import { HomePage } from '@/modules/home/HomePage';
import { PlaceholderPage } from '@/modules/placeholder/PlaceholderPage';
import { NotificationsPage } from '@/modules/system/NotificationsPage';
import { SystemMasterPage } from '@/modules/system/SystemMasterPage';
import { Authed, SystemOnly, WithMe } from './guards';

const placeholderRoutes = ALL_ITEMS.filter((i) => i.phase > 0).map((i) => ({
  path: i.path,
  element: <PlaceholderPage />,
}));

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <Authed />,
    children: [
      { index: true, element: <WithMe render={(me) => <HomePage me={me} />} /> },
      { path: '/account', element: <WithMe render={(me) => <AccountPage me={me} />} /> },
      { path: '/notifications', element: <NotificationsPage /> },
      ...placeholderRoutes.filter((r) => !r.path.startsWith('/system')),
      {
        element: <SystemOnly />,
        children: [
          { path: '/system', element: <SystemMasterPage /> },
          { path: '/dev/ui', element: <WithMe render={(me) => <UiKitPage me={me} />} /> },
          ...placeholderRoutes.filter((r) => r.path.startsWith('/system')),
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
