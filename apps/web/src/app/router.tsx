import { createBrowserRouter, Navigate } from 'react-router';
import { ALL_ITEMS } from '@/layout/nav';
import { AccountPage } from '@/modules/account/AccountPage';
import { LoginPage } from '@/modules/auth/LoginPage';
import { UiKitPage } from '@/modules/dev/UiKitPage';
import { HomePage } from '@/modules/home/HomePage';
import { PlaceholderPage } from '@/modules/placeholder/PlaceholderPage';
import { NotificationsPage } from '@/modules/system/NotificationsPage';
import { AppearanceTab } from '@/modules/system/appearance/AppearanceTab';
import { Branches } from '@/modules/system/company/Branches';
import { CompanyProfile } from '@/modules/system/company/CompanyProfile';
import { CompanySetupTab } from '@/modules/system/company/CompanySetupTab';
import { Designations } from '@/modules/system/company/Designations';
import { Shifts } from '@/modules/system/company/Shifts';
import { DepartmentsTab } from '@/modules/system/departments/DepartmentsTab';
import { OrgChartTab } from '@/modules/system/orgchart/OrgChartTab';
import { RolesTab } from '@/modules/system/roles/RolesTab';
import { SystemMasterLayout } from '@/modules/system/SystemMasterPage';
import { UsersTab } from '@/modules/system/users/UsersTab';
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
          { path: '/dev/ui', element: <WithMe render={(me) => <UiKitPage me={me} />} /> },
          {
            path: '/system',
            element: <SystemMasterLayout />,
            children: [
              { index: true, element: <Navigate to="/system/company" replace /> },
              {
                path: 'company',
                element: <CompanySetupTab />,
                children: [
                  { index: true, element: <CompanyProfile /> },
                  { path: 'shifts', element: <Shifts /> },
                  { path: 'branches', element: <Branches /> },
                  { path: 'designations', element: <Designations /> },
                ],
              },
              { path: 'departments', element: <DepartmentsTab /> },
              { path: 'users', element: <UsersTab /> },
              { path: 'roles', element: <RolesTab /> },
              { path: 'org-chart', element: <OrgChartTab /> },
              { path: 'appearance', element: <AppearanceTab /> },
              ...placeholderRoutes.filter((r) => r.path.startsWith('/system')),
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
